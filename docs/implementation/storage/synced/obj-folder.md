
# Device folder, dedicated for a versioned object.

Object's folder on a device is a persistent local place to cache object's bytes for both faster response times, and offline work.

We want to atomize operations as much as possible and keep track of bits that have been processed and still need to be processed. For example, when downloading object's version, it should be possible to download only part of it, and keep partial download. When uploading (sync-ing), progress should also be tracked. And object's folder is used to keep object's bytes, and to keep operations' info file(s).

All object operations should use this device folder as either a start or an end point for data and info, providing for a clear separation of concerns between processes:
 - Object bytes' reading operation should take bytes from disk. It may ask and wait for a downloader to deliver needed bytes to local disk.
 - Downloader records both downloaded bytes and information about download, so as to know precisely which chunks are already on a disk, and which are not.
 - Uploader (sync-er) takes bytes from a disk and uploads them to server, recording its progress, allowing for resumption of incomplete operations.


## Files in folder.

Currently, there are four file types:
 1. single `status` json file with info about object's versions, i.e. status of the object,
 2. multiple `v.` files with object bytes, where `v` is an integer, 1 or greater, a particular object version,
 3. multiple `v.progress` json files that track a download progress of a particular version, when not all bytes are on the disk,
 4. single `sync-upload` json file with info about sync-ing process.
