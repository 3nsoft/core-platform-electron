## Archival note

[PrivacySafe](https://github.com/PrivacySafe/privacysafe-platform-electron) in now a reference implementation of 3NWeb client platform.


# Client-side 3NWeb platform

This repository contains client-side 3NWeb platform.
Platform's core talks 3NWeb protocols with servers, does all of crypto, keeps all user's keys, and provides an easy-to-use API for apps that run in 3NWeb platform.

This is a desktop implementation of 3NWeb platform, and it uses [Electron](https://www.electronjs.org/).
Platform's core runs as a main process, while apps run in renderer processes.


## Platform setup notes

Some of the used packages may need local recompilation, like node-fuse-bindings for mounting storage's file systems into native OS, requiring some setup.

### Linux

The following kitchen sink is apt-ed in Ubuntu, besides node:
```
apt-get install -y make gcc gcc-multilib g++ g++-multilib pkg-config build-essential libfuse-dev fuse
```

### Windows

Install:
- node, minimum version 14.x. In GUI installer check option that installs chocolatery with the whole kitchen sink that also pulls in Visual Studio libraries.
- git with included MINGW that has bash and other things for reuse of scripts on Windows.
- [Dokany](https://github.com/dokan-dev/dokany) to give FUSE on Windows. Ensure to check installation of files for development, else C headers won't be available.

Ensure that bash is accessible in path. Adding something like `C:\Program Files\Git\bin` to `PATH` environment variable will help. Adjust path in admin console with `setx path /M ...`, else you may have repeating entries, coupled with hard 1024 char limit.


### Mac


## Usage

To use this repo, you need [Node.js](https://nodejs.org/), minimum version 14.x.

First run
```
npm ci
```
that will restore packages in accordance to package-lock, including development tools like TypeScript.

Use npm scripts:
```
npm run
```
will show different available tasks.


# License

Code is provided here under GNU General Public License, version 3.

All API's, available to apps that run in 3NWeb platform, are free for anyone to use, to implement, to do anything with them.
We specifically *do not* subscribe to USA's court's concept that API is copyrightable.
