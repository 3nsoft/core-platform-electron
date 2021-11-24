import { specs as sendToWrongAddress } from './send-to-wrong-address.js';
import { specs as sendWithoutAttachments } from './send-without-attachments.js';
import { specs as sendWithAttachments } from './send-with-attacment-from-storage.js';
import { specs as events } from './events.js';

export const specs = [
	sendToWrongAddress, sendWithoutAttachments, sendWithAttachments, events
];
