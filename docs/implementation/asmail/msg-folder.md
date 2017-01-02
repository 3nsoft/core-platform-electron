# Message folder, dedicated for an incoming message.

Message folder on a device is a persistent local place to cache incoming message's bytes for both faster response times, and offline work.

We want to atomize operations as much as possible. For example, when downloading message, it should be possible to download only part of it, and keep partial download.

All message operations should use this device folder as either a start or an end point for data and info, providing for a clear separation of concerns between processes:
 - Object bytes' reading operation should take bytes from disk. It may ask and wait for a downloader to deliver needed bytes to local disk.
 - Downloader records both downloaded bytes and information about download, so as to know precisely which chunks are already on a disk, and which are not.


## Files in folder.

Currently, there are four file types:
 1. single `status` json file with info the message and its download status,
 2. single `meta` json file with message metadata from a server,
 3. multiple `objId.hxsp` files with message object header bytes, where `objId` is message object's id,
 4. multiple `objId.sxsp` files with message object segments bytes, where `objId` is message object's id.
