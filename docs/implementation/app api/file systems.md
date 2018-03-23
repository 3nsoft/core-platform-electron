
# File systems in 3NWeb platform

## General comments on fs api design

### Overall style

By now, Javascript developers may have seen two major styles for filesystem api.

The first style is that of node's `fs` module. There are functions to manipulate objects in file systems. These accept string paths to identify elements that should be manipulated. If one can create a proper string, any object can be accessed, unless file permissions, associated with the overall process restrict such actions. Permission based access is the oldest tech, present in all operating systems.

The second style is a use of object references as grants within POLA (Principle Of Least Authority, see [Marc Stiegler talk "The Lazy Programmer's Guide to Secure Computing"](https://www.youtube.com/watch?v=eL5o4PFuxTY)). Such approach is much simpler for meshing different applications that have limited trust between each other. Now defunct [FileSystem API from W3C](https://www.w3.org/TR/file-system-api/) is an example of POLA style file system api for the web.

With W3C's api, one has to get an object to do any operations on them. This means that simple listing of `grandparent/parent/folder` requires explicit traversing a hierarchy of object. Of cause, this is not as short as node's `fs.readdir('grandparent/parent/folder')`. Node's api is like jQuery was in comparison to direct DOM manipulation.

When you get a folder object in W3C api, you are implicitly granted authority over it and its content, and node-like operations can be done in the tree of the folder. 3NWeb adopts hybrid approach, that is based on POLA, yet provides convenient access on a file system sub-tree, accessible via granted object. An application may give someone else a folder or file object from its own sub-tree, allowing  other's access only to given parts and nothing else.

### Versions and concurrency

Application on 3NWeb platform may have access to both local and remote file systems.

Regular file system on a device usually doesn't expose developer to timing issues. Synchronization issues arise only when several processes concurrently manipulate the same file objects. These cases are not a majority, hence, api for file systems usually doesn't provide explicit ways to deal with concurrency issues.

3NStorage provides a base for file system that can be accessed over an unreliable network, by potentially many processes at once. Unreliability of a network itself introduces a need for a transaction-style writes, together with tracing object's versions. We may build a file system with api oblivious of timing and concurrency issues, but, as practice shows, these issues leak soon enough. Therefore, api for file systems with transactions and versions exposes them allowing developer to deal with concurrency in a most efficient way.
