

# Client-side 3NWeb platform

This repository contains client-side 3NWeb platform.
Platform's core talks 3NWeb protocols with servers, does all of crypto, keeps all user's keys, and provides an easy-to-use API for apps that run in 3NWeb platform.

This is a destop implementation of 3NWeb platform, and it uses [Electron](http://electron.atom.io/).
Platform's core runs as a main process, while apps run in renderer processes.

## Usage

To use this repo, you need [Node.js](https://nodejs.org/) with [Typescript](http://www.typescriptlang.org/), installed globally to Node.js (with flag `-g`).

When in the project's folder, run
```
npm install
```
to pull in all necessary dependencies.

After that, run npm scripts:
```
npm run gulp help
```
to see different available tasks.

# License

Code is provided here under GNU General Public License, version 3.

All API's, available to apps that run in 3NWeb platform, are free for anyone to use, to implement, to do anything with them.
We specifically *do not* subscribe to USA's court's concept that API is copyrightable.

