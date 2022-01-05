
import { specs as deleteFileSpecs } from './deleteFile.js';
import { specs as deleteFolderSpecs } from './deleteFolder.js';
import { specs as getByteSinkSpecs } from './getByteSink.js';
import { specs as getByteSourceSpecs } from './getByteSource.js';
import { specs as getXAttrSpecs } from './getXAttr.js';
import { specs as linkSpecs } from './link.js';
import { specs as listFolderSpecs } from './listFolder.js';
import { specs as listXAttrsSpecs } from './listXAttrs.js';
import { specs as makeFolderSpecs } from './makeFolder.js';
import { specs as moveSpecs } from './move.js';
import { specs as readBytesSpecs } from './readBytes.js';
import { specs as readJSONFileSpecs } from './readJSONFile.js';
import { specs as readLinkSpecs } from './readLink.js';
import { specs as readonlyFileSpecs } from './readonlyFile.js';
import { specs as readonlySubRootSpecs } from './readonlySubRoot.js';
import { specs as readTxtFileSpecs } from './readTxtFile.js';
import { specs as selectSpecs } from './select.js';
import { specs as statSpecs } from './stat.js';
import { specs as updateXAttrsSpecs } from './updateXAttrs.js';
import { specs as writableFileSpecs } from './writableFile.js';
import { specs as writableSubRootSpecs } from './writableSubRoot.js';
import { specs as writeBytesSpecs } from './writeBytes.js';
import { specs as writeJSONFileSpecs } from './writeJSONFile.js';
import { specs as writeTxtFileSpecs } from './writeTxtFile.js';

export const specs = [
	deleteFileSpecs, deleteFolderSpecs,
	getByteSinkSpecs, getByteSourceSpecs, getXAttrSpecs,
	linkSpecs, listFolderSpecs, listXAttrsSpecs,
	makeFolderSpecs, moveSpecs,
	readBytesSpecs, readJSONFileSpecs,readLinkSpecs,
	readonlyFileSpecs, readonlySubRootSpecs, readTxtFileSpecs,
	selectSpecs, statSpecs,
	updateXAttrsSpecs,
	writableFileSpecs, writableSubRootSpecs, writeBytesSpecs,
	writeJSONFileSpecs, writeTxtFileSpecs
];
