/**
 * webrepl protocol implementation in async TypeScript
 */
// import fs from 'fs'
import WebSocket from 'isomorphic-ws'
import { InvalidPassword, CouldNotConnect, ScriptExecutionError } from './errors'
import { debug, dedent } from './utils';
export { InvalidPassword, CouldNotConnect, ScriptExecutionError }
import { ls } from './python-scripts';

// let SerialPort = null
// if (globalThis.process?.release?.name) {
//   SerialPort = require('serialport')
// }
// console.log('sp', SerialPort)

const delayMillis = (delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs));

export enum DeviceMode {
  SERIAL = "SERIAL",
  NETWORK = "NETWORK",
}

export enum WebReplState {
  CONNECTING = 'CONNECTING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum WebReplMode {
  TERMINAL = 'TERMINAL',  // direct IO with user/program
  SCRIPT_RAW_MODE = 'SCRIPT_RAW_MODE',  // RAW mode for script execution

  GETVER_WAITING_RESPONSE = 'GETVER_WAITING_RESPONSE',
  PUTFILE_WAITING_FIRST_RESPONSE = 'PUTFILE_WAITING_FIRST_RESPONSE',
  PUTFILE_WAITING_FINAL_RESPONSE = 'PUTFILE_WAITING_FINAL_RESPONSE',
}

export enum RawReplState {
  ENTERING = 'ENTERING',
  ENTERING_WAITING_FOR_START = 'ENTERING_WAITING_FOR_START',
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
  SCRIPT_SENT = 'SCRIPT_SENT',
  SCRIPT_RECEIVING_RESPONSE = 'SCRIPT_RECEIVING_RESPONSE',
  CHANGING_TO_FRIENDLY_REPL = 'CHANGING_TO_FRIENDLY_REPL',
}

enum RawReplReceivingResponseSubState {
  SCRIPT_RECEIVING_OUTPUT = 'SCRIPT_RECEIVING_OUTPUT',
  SCRIPT_RECEIVING_ERROR = 'SCRIPT_RECEIVING_ERROR',
  SCRIPT_WAITING_FOR_END = 'SCRIPT_WAITING_FOR_END',
}

export interface WebReplOptions {
  attachStateToWindow: boolean | Window
}

type promiseResolve = (value: string | PromiseLike<string>) => void;
type promiseReject = (reason: any) => void;

export interface IWebReplState {
  deviceMode: DeviceMode

  port: any
  ws: WebSocket | null

  replState: WebReplState
  replMode: WebReplMode // only if replState is connected
  replPassword: string

  // promise helpers for user script
  replPromise: Promise<string> | null;  // helper to await command executions
  replPromiseResolve: promiseResolve | null
  replPromiseReject: promiseReject | null

  rawReplState: RawReplState

  lastCommand: string
  inputBuffer: string
  errorBuffer: string

  lastRunScriptTimeNeeded: number
  receivingResponseSubState: RawReplReceivingResponseSubState

  putFileSize: number
  putFileData: Uint8Array
  putFileName: string
  putFileDest: string
}

export interface WindowWithWebRepl extends Window {
  [x: string]: any;
  testWindow: any;
  webReplState: IWebReplState | undefined
}

interface FileListEntry { filename: string, size: number, isDir: boolean }

declare const window: WindowWithWebRepl;

export class MicroPythonDevice {
  onclose: () => void
  onTerminalData: (data: string) => void  // user callback
  state: IWebReplState

  private getInitState(): IWebReplState {
    return {
      deviceMode: DeviceMode.NETWORK,
      port: null,
      ws: null,
      replState: WebReplState.CLOSED,
      replMode: WebReplMode.TERMINAL,
      inputBuffer: '',
      errorBuffer: '',
      replPassword: '',
      lastCommand: '',

      replPromise: null,
      replPromiseResolve: null,
      replPromiseReject: null,

      rawReplState: RawReplState.WAITING_FOR_INPUT,
      lastRunScriptTimeNeeded: -1,
      receivingResponseSubState: RawReplReceivingResponseSubState.SCRIPT_RECEIVING_ERROR,

      putFileSize: 0,
      putFileData: new Uint8Array(),
      putFileName: '',
      putFileDest: '',
    }
  }

  constructor(options?: WebReplOptions) {
    // State init, either local only or also on a window instance (for code hot reloading)
    if (options?.attachStateToWindow) {
      this.attachStateToWindow(options.attachStateToWindow)
    } else {
      // Normal local state init
      this.state = this.getInitState()
    }
  }

  isSerialDevice() {
    return this.state.deviceMode === DeviceMode.SERIAL
  }

  /**
   * attachStateToWindow is a dev helper to allow code hot reloading (reusing a websocket/webrepl instance across code reloads)
   */
  private attachStateToWindow(targetWindow: Window | boolean) {
    // console.log('attachStateToWindow', targetWindow)

    const getTargetWindow = () => {
      if (typeof targetWindow === 'boolean') {
        // console.log('attach state to the default window')
        if (typeof window === 'undefined') {
          throw new Error('Cannot attach state to window because window is undefined')
        }
        return window
      } else {
        // console.log('attach state to an existing window')
        return targetWindow
      }
    }

    const _targetWindow = getTargetWindow() as WindowWithWebRepl

    if (_targetWindow.webReplState && _targetWindow.webReplState.ws) {
      // console.log('hot reloading state from window')
      this.state = _targetWindow.webReplState
    } else {
      // console.log('initial state creation')
      _targetWindow.webReplState = this.state = this.getInitState()
    }
  }

  public async connectSerial(path: string) {
    debug('connectSerial', path)
    // Connect to serial device
    this.state.deviceMode = DeviceMode.SERIAL
    this.state.replState = WebReplState.CONNECTING

    // const SerialPort = require('serialport')
    // this.state.port = new SerialPort(path, { baudRate: 115200 })

    // Add error listener
    this.state.port.on('error', (err: string) => {
      if (this.state.replPromiseReject) {
        debug(err)
        const e = this.state.replState === WebReplState.CONNECTING ? new CouldNotConnect(err.toString()) : err
        this.state.replPromiseReject(e)
      } else {
        throw err
      }
    })

    // Add data listener
    this.state.port.on('data', (data: Buffer) => {
      // console.log('Data:', data.toString())

      if (this.state.replState === WebReplState.CONNECTING && data.toString().trim().endsWith('>>>')) {
        this.state.replState = WebReplState.OPEN
        this.state.replMode = WebReplMode.TERMINAL
        this.state.inputBuffer = ''
        if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
        return
      }

      this.handleProtocolData(data)
    })

    this.state.port!.write('\x02')  // Required to send Ctrl+B, so we receive the info that we are in REPL mode
    return this.createReplPromise()
  }

  public async connectNetwork(host: string, password: string) {
    this.state.deviceMode = DeviceMode.NETWORK

    // check if already a websocket connection active
    if (this.state.ws && this.state.ws.readyState !== WebSocket.CLOSED) {  // see also https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
      console.warn("webrepl: Cannot connect, already active ws connection", this.state.ws)
      return
    }

    const uri = `ws://${host}:8266`
    // console.log('connect', uri)
    this.state.replState = WebReplState.CONNECTING
    this.state.replPassword = password

    this.state.ws = new WebSocket(uri)
    this.state.ws.binaryType = 'arraybuffer'

    // this.state.ws.onopen = () => console.log(`WebSocket connected`)
    this.state.ws.onmessage = (event) => this.handleWebsocketMessage(event)
    this.state.ws.onerror = (err) => {
      // console.log(`WebSocket onerror`, err)
      const e = this.state.replState === WebReplState.CONNECTING ? new CouldNotConnect(err.message) : err
      if (this.state.replPromiseReject) this.state.replPromiseReject(e)
    }

    this.state.ws.onclose = () => {
      // console.log(`WebSocket onclose`)
      this.state.replState = WebReplState.CLOSED
      if (this.state.replPromiseResolve) this.state.replPromiseResolve('') // release the 'close' async event
      if (this.onclose) this.onclose()
    }

    // create and return a new promise, which is fulfilled only after connecting to repl
    return this.createReplPromise()
  }

  private createReplPromise(): Promise<string> {
    this.state.replPromise = new Promise((resolve, reject) => {
      this.state.replPromiseResolve = resolve
      this.state.replPromiseReject = reject
    })
    return this.state.replPromise
  }


  /**
   * Handle special commands output
   *
   * getver, putfile, getfile
   */
  private handlProtocolSpecialCommandsOutput(data: Uint8Array) {
    // helper to decode the binary data
    const decodeWebreplBinaryResponse = (_data: Uint8Array) => {
      if (_data[0] === 'W'.charCodeAt(0) && _data[1] === 'B'.charCodeAt(0)) {
        // tslint:disable-next-line: no-bitwise
        const code = _data[2] | (_data[3] << 8);
        return code;
      } else {
        return -1;
      }
    }

    // HANDLE SPECIFIC SPECIAL COMMANDS (getver, putfile, getfile)
    if (this.state.replMode === WebReplMode.PUTFILE_WAITING_FIRST_RESPONSE) {
      // PUTFILE
      if (decodeWebreplBinaryResponse(data) === 0) {
        // send file data in chunks
        for (let offset = 0; offset < this.state.putFileSize; offset += 1024) {
          this.sendData(this.state.putFileData.slice(offset, offset + 1024));
        }
        this.state.replMode = WebReplMode.PUTFILE_WAITING_FINAL_RESPONSE;
      }

    } else if (this.state.replMode === WebReplMode.PUTFILE_WAITING_FINAL_RESPONSE) {
      // final response for put
      if (decodeWebreplBinaryResponse(data) === 0) {
        debug('Upload success');
        if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
      } else {
        console.error('Upload failed');
        if (this.state.replPromiseReject) this.state.replPromiseReject('Upload failed')
      }
      this.state.replMode = WebReplMode.TERMINAL

    } else if (this.state.replMode === WebReplMode.GETVER_WAITING_RESPONSE) {
      // GETVER
      // console.log('got getver response:', data, data.toString())
      if (this.state.replPromiseResolve) this.state.replPromiseResolve(data.join("."))

    } else {
      console.log('unkown ArrayBuffer input:', data)
    }
  }

  private handleWebsocketMessage(event: WebSocket.MessageEvent) {
    const dataStr = event.data.toString()
    const dataTrimmed = dataStr.trim()
    // console.log(`onWebsocketMessage:${event.data instanceof ArrayBuffer ? ' [ArrayBuffer]' : ''}${data.endsWith('\n') ? ' [End:\\n]' : ''}${data.length < 3 ? ' [char0:' + data.charCodeAt(0) + ']'  : ''}`, data.length, data)

    // do nothing if special final bytes on closing a ws connection
    if (this.state.ws!.readyState === WebSocket.CLOSING && dataStr.length === 2 && dataStr.charCodeAt(0) === 65533 && dataStr.charCodeAt(1) === 0) return

    if (event.data instanceof ArrayBuffer) {
      // debug("In: ArrayBuffer")
      const binData = new Uint8Array(event.data);
      this.handlProtocolSpecialCommandsOutput(binData)
      return
    }

    /**
     * CONNECTING
     */
    if (this.state.replState === WebReplState.CONNECTING) {
      if (dataTrimmed === 'Password:') {
        this.state.ws!.send(this.state.replPassword + '\r')
        return

      } else if (dataTrimmed === 'Access denied') {
        this.state.ws!.close()  // just to be sure. micropy already closes the connection
        if (this.state.replPromiseReject) this.state.replPromiseReject(new InvalidPassword('REPL password invalid'))
        return

      } else if (dataTrimmed.startsWith('WebREPL connected')) {
        this.state.replState = WebReplState.OPEN
        this.state.replMode = WebReplMode.TERMINAL
        this.state.inputBuffer = ''
        if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
        return
      }
    }

    this.handleProtocolData(Buffer.from(event.data))
  }

  /**
   * Handle any normal logged in data
   */
  private handleProtocolData(data: Uint8Array) {
    // debug('handleProtocolData:', data, data.toString())

    if (this.state.replMode === WebReplMode.GETVER_WAITING_RESPONSE) {
      return this.handlProtocolSpecialCommandsOutput(data)
    }
    /**
     * FRIENDLY MODE REPL / TERMINAL MODE
     */
    if (this.state.replMode === WebReplMode.TERMINAL) {
      // pass terminal on to user defined handler
      // console.log('term:', data, data.length)
      if (this.onTerminalData) this.onTerminalData(data.toString())
      return
    }

    /**
     * RAW MODE REPL (to run scripts)
     */
    const dataStr = data.toString()
    const dataTrimmed = dataStr.trim()

    if (this.state.replMode === WebReplMode.SCRIPT_RAW_MODE) {
      // console.log(`raw_mode: '${dataStr}'`, data.length, data.length > 0 ? data.charCodeAt(data.length - 1) : '')
      // console.log(`raw_mode: '${dataStr}'`, data.length, data.length > 0 ? data[data.length - 1] : '', data)

      if (this.state.rawReplState === RawReplState.ENTERING) {
        const waitFor1 = `raw REPL; CTRL-B to exit`
        if (dataTrimmed.startsWith(waitFor1)) {
          if (dataTrimmed.endsWith('\n>')) {
            // serial: > comes in one message, while over network it's spliut
            this.state.replMode = WebReplMode.SCRIPT_RAW_MODE
            if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
          } else {
            this.state.rawReplState = RawReplState.ENTERING_WAITING_FOR_START
          }
        }

      } else if (this.state.rawReplState === RawReplState.ENTERING_WAITING_FOR_START) {
        if (dataStr === '>') {
          // console.log('_raw mode start', !!this.state.replModeSwitchPromiseResolve)
          this.state.replMode = WebReplMode.SCRIPT_RAW_MODE
          if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
        }

      } else if (this.state.rawReplState === RawReplState.SCRIPT_SENT) {
        if (dataStr === 'OK') {
          // console.log('ok received, start collecting input')
          this.state.inputBuffer = ''
          this.state.errorBuffer = ''
          this.state.rawReplState = RawReplState.SCRIPT_RECEIVING_RESPONSE
          this.state.receivingResponseSubState = RawReplReceivingResponseSubState.SCRIPT_RECEIVING_OUTPUT
        } else {
          console.error('error: should have received OK, received:', data)
        }
        return
      }

      // SCRIPT OUTPUT: OK[ok_output]\x04[error_output][x04]>
      if (this.state.rawReplState === RawReplState.SCRIPT_RECEIVING_RESPONSE) {
        // debug('receive:', data)
        for (const entry of data) {
          // debug(entry)
          if (entry === 0x04 && this.state.receivingResponseSubState === RawReplReceivingResponseSubState.SCRIPT_RECEIVING_OUTPUT) {
            // debug('switch to error mode')
            this.state.receivingResponseSubState = RawReplReceivingResponseSubState.SCRIPT_RECEIVING_ERROR
          } else if (entry === 0x04 && this.state.receivingResponseSubState === RawReplReceivingResponseSubState.SCRIPT_RECEIVING_ERROR) {
            // debug('switch to end mode')
            this.state.receivingResponseSubState = RawReplReceivingResponseSubState.SCRIPT_WAITING_FOR_END
          } else if (entry === 62 && this.state.receivingResponseSubState === RawReplReceivingResponseSubState.SCRIPT_WAITING_FOR_END) {
            // debug('all done!!!')

            // ALL DONE
            this.state.inputBuffer = this.state.inputBuffer.trim()
            this.state.errorBuffer = this.state.errorBuffer.trim()
            // console.log('END', this.state.inputBuffer, this.state.errorBuffer)
            this.state.rawReplState = RawReplState.WAITING_FOR_INPUT

            if (this.state.errorBuffer.length > 0 && this.state.replPromiseReject) {
              this.state.replPromiseReject(new ScriptExecutionError(this.state.errorBuffer))
            } else if (this.state.replPromiseResolve) {
              this.state.replPromiseResolve(this.state.inputBuffer)
            }
          } else {
            // add to buffer
            if (this.state.receivingResponseSubState === RawReplReceivingResponseSubState.SCRIPT_RECEIVING_OUTPUT) {
              // debug('adding to buffer:', entry)
              this.state.inputBuffer += String.fromCharCode(entry)
            } else {
              // debug('adding to error buffer:', entry)
              this.state.errorBuffer += String.fromCharCode(entry)
            }
          }
        }

      } else if (this.state.rawReplState === RawReplState.CHANGING_TO_FRIENDLY_REPL) {
        // console.log('x', data, dataStr)
        if (dataTrimmed.endsWith('>>>')) {
          // console.log('__ back in friendly repl mode')
          this.state.rawReplState = RawReplState.WAITING_FOR_INPUT
          this.state.replMode = WebReplMode.TERMINAL
          if (this.state.replPromiseResolve) this.state.replPromiseResolve('')
        }
      }
    }
  }

  isConnected() {
    return this.state.replState === WebReplState.OPEN
  }

  sendData(data: string | Buffer | ArrayBuffer) {
    if (this.state.deviceMode === DeviceMode.NETWORK) {
      return this.wsSendData(data)
    } else {
      if (data instanceof ArrayBuffer) {
        this.serialSendData(Buffer.from(data))
      } else {
        this.serialSendData(data)
      }
    }
  }

  serialSendData(data: string | Buffer) {
    // debug('serialSendData', data)
    this.state.port?.write(data)
  }

  wsSendData(data: string | ArrayBuffer) {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
      throw new Error('wsSendData: No open websocket')
    }
    // console.log('wsSendData', data)
    this.state.ws.send(data)
  }

  public async close() {
    if (this.isSerialDevice()) {
      await this.state.port?.close()
      this.state.replState = WebReplState.CLOSED
      // return this.createReplPromise()
    } else {
      await this.closeWebsocket()
    }
  }

  private async closeWebsocket() {
    if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
      // console.log('closing')
      this.state.ws.close()
      this.state.replState = WebReplState.CLOSED
      return this.createReplPromise()
    } else {
      debug('main.close(): wanting to close already closed websocket')
      return false
    }
  }

  /**
   *
   * @param script
   * @param disableDedent
   *
   * @throws: ScriptExecutionError on Python code execution error
   */
  public async runScript(script: string, disableDedent = false) {
    debug('runScript', script)

    await this.enterRawRepl()
    // debug('runScript: raw mode entered')

    // Prepare script for execution (dedent by default)
    if (!disableDedent) script = dedent(script)

    // Send data to raw repl. Note: cannot send too much data at once over the
    // network, else the webrepl can't parse it quick enough and returns an error.
    // Therefore we chunk the data and add a send delay.
    // 120b and 180ms delay seems to work well for all ESP32 devices.
    const chunkSize = this.isSerialDevice() ? 3000 : 120;  // how many bytes to send per chunk.
    const chunkDelayMillis = this.isSerialDevice() ? 0 : 200;  // fixed delay. a progressive delay doesn't seem to help
    debug(`runScript: ${script.length} bytes -> ${Math.ceil(script.length / chunkSize)} chunks`)

    while (script.length) {
      const chunk = script.substring(0, chunkSize)
      script = script.substr(chunkSize)
      this.sendData(chunk)
      await delayMillis(chunkDelayMillis)
    }

    // debug('runScript: script sent')
    const millisStart = Date.now()

    // Update state and create a new promise that will be fulfilled when script has run
    this.state.rawReplState = RawReplState.SCRIPT_SENT
    const promise = this.createReplPromise()

    // Send ctrl+D to execute the uploaded script in the raw repl
    this.sendData('\x04')
    debug('runScript: script sent, waiting for response')

    // wait for script execution
    const scriptOutput = await promise
    debug(scriptOutput)

    const millisRuntime = Math.round(Date.now() - millisStart)
    debug(`runScript: script done (${millisRuntime / 1000}sec)`)
    this.state.lastRunScriptTimeNeeded = millisRuntime

    // Exit raw repl mode, re-enter friendly repl
    await this.exitRawRepl()
    // console.log('runScript: exited RAW repl')

    return scriptOutput
  }

  private async enterRawRepl() {
    // see also https://github.com/scientifichackers/ampy/blob/master/ampy/pyboard.py#L175
    // Prepare state for mode switch
    // debug('enterRawRepl')
    this.state.replMode = WebReplMode.SCRIPT_RAW_MODE
    this.state.rawReplState = RawReplState.ENTERING

    const promise = this.createReplPromise()
    // Send ctrl-C twice to interrupt any running program
    this.sendData('\r\x03')
    await delayMillis(100) // wait 0.1sec
    this.sendData('\x03')
    await delayMillis(100) // wait 0.1sec
    this.sendData('\x01')  // ctrl+A
    await delayMillis(100) // wait 0.1sec

    return promise
  }

  private async exitRawRepl() {
    // console.log('exitRawRepl')
    this.state.rawReplState = RawReplState.CHANGING_TO_FRIENDLY_REPL
    const promise = this.createReplPromise()
    this.sendData('\r\x02')
    return promise
  }

  public async getVer(): Promise<string> {
    // debug(`getVer`)
    if (this.isSerialDevice()) {
      throw new Error("getVer is not possible with a serial connection (only with webrepl)")
    }

    const promise = this.createReplPromise()

    this.state.replMode = WebReplMode.GETVER_WAITING_RESPONSE

    // WEBREPL_REQ_S = "<2sBBQLH64s"
    const rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
    rec[0] = 'W'.charCodeAt(0);
    rec[1] = 'A'.charCodeAt(0);
    rec[2] = 3; // GET_VER

    // initiate put
    this.sendData(rec)
    const ret = await promise
    return ret
  }

  public async uploadFile(filename: string, destFilename: string) {
    debug(`uploadFile: ${filename} -> ${destFilename}`)
    // const promise = this.createReplPromise()

    // this.state.replMode = WebReplMode.PUTFILE_WAITING_FIRST_RESPONSE
    // this.state.putFileName = filename
    // this.state.putFileDest = destFilename

    // this.state.putFileData = new Uint8Array(fs.readFileSync(filename))
    // this.state.putFileSize = this.state.putFileData.length
    // debug(`uploadFile: ${this.state.putFileSize} bytes`)

    // // WEBREPL_FILE = "<2sBBQLH64s"
    // const rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
    // rec[0] = 'W'.charCodeAt(0);
    // rec[1] = 'A'.charCodeAt(0);
    // rec[2] = 1; // put
    // rec[3] = 0;
    // rec[4] = 0; rec[5] = 0; rec[6] = 0; rec[7] = 0; rec[8] = 0; rec[9] = 0; rec[10] = 0; rec[11] = 0;
    // // tslint:disable-next-line: no-bitwise
    // rec[12] = this.state.putFileSize & 0xff; rec[13] = (this.state.putFileSize >> 8) & 0xff; rec[14] = (this.state.putFileSize >> 16) & 0xff; rec[15] = (this.state.putFileSize >> 24) & 0xff;
    // // tslint:disable-next-line: no-bitwise
    // rec[16] = this.state.putFileDest.length & 0xff; rec[17] = (this.state.putFileDest.length >> 8) & 0xff;
    // for (let i = 0; i < 64; ++i) {
    //   rec[18 + i] = i < this.state.putFileDest.length ? this.state.putFileDest.charCodeAt(i) : 0
    // }

    // // initiate put
    // this.sendData(rec)

    // return promise
  }

  public async listFiles(directory = "/", recursive = false): Promise<FileListEntry[]> {
    debug(`listFiles: ${directory}`)
    const output = await this.runScript(ls({ directory, recursive }))
    const lines = output.split('\n')

    const ret: FileListEntry[] = []
    for (const line of lines) {
      const parts = line.split(' | ')
      if (parts[0] === '') continue
      ret.push({
        filename: parts[0],
        size: parseInt(parts[2], 10),
        isDir: parts[1] === 'd',
      })
    }
    return ret
  }
}
