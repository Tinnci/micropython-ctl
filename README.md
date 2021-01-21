# MicroPython-Ctl: MicroPython ❤️ TypeScript

Build things that talk to MicroPython devices: websites/webapps, Node.js programs, Electron applications, VS Code extensions, and more.

[![Build and test status](https://github.com/metachris/micropython-ctl/workflows/Build%20and%20test/badge.svg)](https://github.com/metachris/micropython-ctl/actions?query=workflow%3A%22Build+and+test%22)

* Modern TypeScript library and cli.
* Connect to devices over serial and network (REPL and WebREPL).
* Functionality:
  * Run Python scripts, await the output
  * Manipulate files and directories
  * Terminal (REPL) interaction
  * [`mctl`](https://github.com/metachris/micropython-ctl/blob/master/cli) command line utility
  * Mount the micropython device into the local filesystem (`mctl mount`, experimental)
* See all the features in the [documentation](https://metachris.github.io/micropython-ctl/classes/micropythondevice.html), [examples](https://github.com/metachris/micropython-ctl/tree/master/examples) and [`cli/`](https://github.com/metachris/micropython-ctl/blob/master/cli)
* Typed and fully async (use `await` with any command).
* Works on Linux, macOS and Windows. Tested with ESP32 & ESP8266.
* Main code files: [`main.ts`](https://github.com/metachris/micropython-ctl/blob/master/src/main.ts), [`cli/index.ts`](https://github.com/metachris/micropython-ctl/blob/master/cli/index.ts)
* Links: [Github](https://github.com/metachris/micropython-ctl), [Documentation](https://metachris.github.io/micropython-ctl/), [npm package](https://www.npmjs.com/package/micropython-ctl)


# Usage

```js
const micropython = new MicroPythonDevice()

// Connect to micropython device over network
await micropython.connectNetwork('DEVICE_IP', 'WEBREPL_PASSWORD')

// Or connect to micropython device over serial interface
await micropython.connectSerial('/dev/ttyUSB0')

// Run a Python script and capture the output
const output = await micropython.runScript('import os; print(os.listdir())')
console.log('runScript output:', output)

// List all files in the root
const files = await micropython.listFiles()
console.log('files:', files)

// Get file contents
const fileContents = await micropython.getFile('boot.py')
console.log(fileContents)

// Set a terminal (REPL) data handler, and send data to the REPL
micropython.onTerminalData = (data) => process.stdout.write(data)
micropython.sendData('\x03\x02')  // Ctrl+C and Ctrl+B to enter friendly repl and print version
```

See also the [MicroPythonDevice docs](https://metachris.github.io/micropython-ctl/classes/micropythondevice.html).

Note: to connect over the network, you need to enable it on the device first, through the serial REPL: `import webrepl_setup` (see [docs](https://docs.micropython.org/en/latest/esp8266/tutorial/repl.html#webrepl-a-prompt-over-wifi)). Also, make sure you can ping the device first.


**Code examples:**

* [examples/basic.ts](https://github.com/metachris/micropython-ctl/blob/master/examples/basic.ts) (run with `yarn ts-node examples/basic.ts`)
* [examples/web-example.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example.html) (open the file in a browser, or view it [live here](http://current.at/micropython-ctl/examples/web-example.html))
* [examples/web-example2-terminal.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example2-terminal.html) (open the file in a browser, or view it [live here](http://current.at/micropython-ctl/examples/web-example2-terminal.html))
* [examples/terminal.ts](https://github.com/metachris/micropython-ctl/blob/master/examples/terminal.ts) (run with `yarn examples/terminal.ts`)
* [cli/index.ts](https://github.com/metachris/micropython-ctl/blob/master/cli/index.ts) (run with `yarn mctl`)

## Browser / Webapps

In websites/webapps, simply include the latest release via CDN (~13kb gzipped):

```html
<script src="https://cdn.jsdelivr.net/npm/micropython-ctl@1.7.3/dist-browser/main.js"></script>
```

Then you can use it like this:

```js
const micropython = new MicroPythonCtl.MicroPythonDevice()
await micropython.connectNetwork(host, password)
```

**Usage example:**

* [examples/web-example.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example.html#L89-L113) - [live here](http://current.at/micropython-ctl/examples/web-example.html)
* [examples/web-example2-terminal.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example2-terminal.html#L112-L130) - [live here](http://current.at/micropython-ctl/examples/web-example2-terminal.html)

**Notes:**

* Browsers don't allow access to USB/serial ports.
* You can enable debug output by opening the console and entering `window.DEBUG = 1`
* You can download the zipped bundle here: [main.js.gz](https://cdn.jsdelivr.net/npm/micropython-ctl@1.5.2/dist-browser/main.js.gz)

## Node.js

Installation:

```shell
# If you use yarn
yarn add micropython-ctl

# Alternatively, if you use npm
npm install micropython-ctl
```

Usage:

```js
// Node.js with TypeScript:
import { MicroPythonDevice } from 'micropython-ctl'

// Node.js without TypeScript:
// const MicroPythonDevice = require('micropython-ctl').MicroPythonDevice

(async () => {
  const micropython = new MicroPythonDevice()

  // Connect to micropython device
  await micropython.connectNetwork('YOUR_IP', 'WEBREPL_PASSWORD')
  // await micropython.connectSerial('/dev/ttyUSB0')

  // Run a Python script and capture the output
  const output = await micropython.runScript('import os; print(os.listdir())')
  console.log('runScript output:', output)

  // List all files in the root
  const files = await micropython.listFiles()
  console.log('files:', files)

  // Close
  await micropython.close()
})()
```

## Examples

Find more examples in [`/examples/`](https://github.com/metachris/micropython-ctl/tree/master/examples). You can run them like this: `yarn ts-node examples/basic.ts`

* [examples/basic.ts](https://github.com/metachris/micropython-ctl/blob/master/examples/basic.ts) (run with `yarn ts-node examples/basic.ts`)
* [examples/web-example.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example.html) (open the file in a browser, or view it [live here](http://current.at/micropython-ctl/examples/web-example.html))
* [examples/web-example2-terminal.html](https://github.com/metachris/micropython-ctl/blob/master/examples/web-example2-terminal.html) (open the file in a browser, or view it [live here](http://current.at/micropython-ctl/examples/web-example2-terminal.html))
* [examples/terminal.ts](https://github.com/metachris/micropython-ctl/blob/master/examples/terminal.ts) (run with `yarn examples/terminal.ts`)
* [cli/index.ts](https://github.com/metachris/micropython-ctl/blob/master/cli/index.ts) (run with `yarn mctl`)


## Building the code

```shell
$ git clone https://github.com/metachris/micropython-ctl.git
$ cd micropython-ctl
$ yarn
$ yarn build
$ yarn lint
$ yarn doc
$ yarn ts-node examples/basic.ts

# Run the test suite (needs a micropython device)
$ yarn test --help
```

---

Enjoy and do cool things with this code! 🚀

---

## Reach out

I'm happy about feedback, please reach out:

* chris@linuxuser.at
* https://twitter.com/metachris


## Inspiration & References

* https://github.com/micropython/webrepl ([original JS implementation](https://github.com/micropython/webrepl/blob/master/webrepl.html))
* https://github.com/scientifichackers/ampy/blob/master/ampy/files.py
* https://github.com/dhylands/rshell#commands
* https://pycopy.readthedocs.io/en/latest/esp32/quickref.html
* https://github.com/micropython/micropython/pull/6375/files (mpr: fs mount PR)


## Future work

Code library:

* getDeviceInfo (device type, mpy version, etc)
* put/get recursively (only upload if changed?)
* putfile and getfile over network: switch to webrepl protocol instead of manual up- and download
* `getFile` improvement - currently it fills the device RAM and probably works badly with large file
* put & get with folders: join path parts windows compatible
* Document all functions with examples (in https://github.com/metachris/micropython-ctl/blob/master/src/main.ts)

`mctl`:

* env vars for device: serial / host, password (see also WEBREPL, AMPY env vars)
* upload everything recursively ('put -r .')
* wifi status, connect, disconnect

Tests:

* getFileHash, isFileTheSame
* `mctl get -r .`, `mctl put -r .`
* automated browser testing (selenium [[1](https://developer.mozilla.org/en-US/docs/Learn/Tools_and_testing/Cross_browser_testing/Your_own_automation_environment)])
* Test most important `mctl` commands

Various:

* Electron example app

Maybe (not sure it's needed, don't rush into implementing):

* mount related
  * mount: testing
  * mount + repl
  * reuse one instance (eg. in mount mode) to execute other commands
  * `mctl mount` issues ([see here](https://github.com/metachris/micropython-ctl/issues/3))
* Vue.js example with attaching the MicroPythonDevice instance to window, so one instance can live across code hot reloads :) (almost done)
* A slim version for the browser with minimal footprint (only core code, no listfiles etc.)
* Support new raw-paste mode: https://github.com/micropython/micropython/blob/master/docs/reference/repl.rst#raw-mode-and-raw-paste-mode (only in master, should be part of MicroPython 1.14)
* Rename ScriptExecutionError to RuntimeError?

---

## Release process

#### Testing

- Run the tests with a Device: `yarn test`
- Test package installation:
  - Prepare: `yarn build && yarn pack`
  - macOS & Linux: run `tests/test-package-installation.sh`
  - Windows: run `E:/tests/test-package-installation.bat`
- Test web examples: In the html files, change imports to local and open in Browser

#### Release

```shell
# Update CHANGELOG
code CHANGELOG.md

# Update cli README
yarn mctl help
code cli/README.md

# make sure all is committed in git
git status

# update version number and create a git tag
yarn version

# create the builds for node and browser
./build.sh

# check the final package
yarn pack && tar -xvf micropython-ctl-v* && ll package/
rm -rf package/ micropython-ctl-v*

# publish
yarn publish

# push to git
git push && git push --tags
```


Update live web examples with code from Github `master` branch:

```
ssh nova "cd /server/websites/current.at/micropython-ctl && git pull"
```

Test the live web examples with Chrome, Firefox, Safari, Edge (on OSX, Linux, Windows and Mobile):

* [web-example.html](http://current.at/micropython-ctl/examples/web-example.html)
* [web-example2-terminal.html](http://current.at/micropython-ctl/examples/web-example2-terminal.html)


Notes:

* Help for writing release notes: https://github.com/metachris/micropython-ctl/compare
* Purge CDN cache: https://purge.jsdelivr.net/npm/micropython-ctl@latest
