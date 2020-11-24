import readline from 'readline'
import { WebREPL, WebReplMode, InvalidPassword } from '../src/main'

const HOST = '10.12.50.101'
const PASSWORD = 'test'

const webrepl = new WebREPL()

// Shut down program on websocket close
webrepl.onclose = () => process.exit(0)

// Keystroke capture for interactive REPL
let maybeQuit = false
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', async (str, key) => {
  // console.log(str, key)

  // can force quit with ^] and ^D (same as in SSH)
  if (maybeQuit && key.sequence === '\u0004' && key.ctrl) {
    process.exit(0)
  }

  // on Ctrl+], remember that user might want to force quit
  maybeQuit = key.sequence === '\u001d'

  // Dirty helper: do something on pressing {
  if (key.sequence === '{') return console.log(webrepl.state.ws)

  // Send key to webrepl
  if (webrepl.state.replMode === WebReplMode.TERMINAL) {
    webrepl.wsSendData(str)
  }
})

// Connect to webrepl and do stuff
const run = async () => {
  try {
    await webrepl.connect(HOST, PASSWORD)
    console.log('WebREPL connected')

  } catch (e) {
    // probably invalid password, but could also invalid host or another websocket error
    if (e instanceof InvalidPassword) {
      console.error('Invalid password')
    } else {
      console.error(e)
    }
  }
}

run()
