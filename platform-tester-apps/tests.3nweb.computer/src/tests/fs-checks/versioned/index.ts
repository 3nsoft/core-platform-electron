
import { specs as getByteSinkSpecs } from './getByteSink.js';
import { specs as getByteSourceSpecs } from './getByteSource.js';
import { specs as listFolderSpecs } from './listFolder.js';
import { specs as readBytesSpecs } from './readBytes.js';
import { specs as readJSONFileSpecs } from './readJSONFile.js';
import { specs as readTxtFileSpecs } from './readTxtFile.js';
import { specs as statSpecs } from './stat.js';
import { specs as writeBytesSpecs } from './writeBytes.js';
import { specs as writeJSONFileSpecs } from './writeJSONFile.js';
import { specs as writeTxtFileSpecs } from './writeTxtFile.js';

export const specs = [
	getByteSinkSpecs, getByteSourceSpecs, listFolderSpecs,
	readBytesSpecs, readJSONFileSpecs, readTxtFileSpecs,
	statSpecs,
	writeBytesSpecs, writeJSONFileSpecs, writeTxtFileSpecs
];