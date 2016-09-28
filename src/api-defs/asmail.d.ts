/*
 Copyright (C) 2016 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

/// <reference path="./web3n.d.ts" />

/**
 * This is a namespace for things used by mail functionality.
 */
declare namespace Web3N.ASMail {
	
	/**
	 * This is a collection of functions, exposed to messaging app.
	 */
	interface Service {
		
		/**
		 * @return a promise resolvable to id (address) of a current signed
		 * user.
		 */
		getUserId(): Promise<string>;
		
		sendMsg(recipient: string, msg: ASMail.OutgoingMessage): Promise<string>;
		
		preFlight(toAddress: string): Promise<number>;
		
		listMsgs(fromTS?: number): Promise<ASMail.MsgInfo[]>;
		
		removeMsg(msgId: string): Promise<void>;
		
		getMsg(msgId: string): Promise<ASMail.IncomingMessage>;
		
		makeAttachmentsContainer(): AttachmentsContainer;
		
	}
	
	interface MsgStruct {
		subject?: string;
		msgType?: string;
		chatId?: string;
		plainTxtBody?: string;
		htmlTxtBody?: string;
		carbonCopy?: string[];
		recipients?: string[];
	}
	
	interface MsgInfo {
		msgId: string;
		deliveryTS: number;
	}
	
	interface IncomingMessage extends MsgInfo, MsgStruct {
		sender: string;
		attachments?: Storage.FS;
	}
	
	interface OutgoingMessage extends MsgStruct {
		msgId?: string;
		attachments?: AttachmentsContainer;
		attachmentsFS?: Storage.FS;
	}
	
	interface AttachmentsContainer {

		/**
		 * @param file is a file object that should be add to this container
		 * @param newName is an optional new name for the file. If it is not
		 * given, file's name will be used.
		 */
		addFile(file: Files.File, newName?: string): void;

		/**
		 * @param initName is an initial name of file or folder in this container.
		 * An error is thrown, if given name does not correspond to any entity in
		 * this container.
		 * @param newName is a new name for an indicated file/folder. An error is
		 * thrown, if this name is already used by one of entities in this
		 * container.
		 */
		rename(initName: string, newName: string): void;

		/**
		 * @return a map with all attachments as values, and attachemt names as
		 * keys.
		 */
		getAll(): Map<string, Files.File>;

	}
	
	interface InboxException extends RuntimeException {
		msgId: string;
		msgNotFound?: boolean;
		objNotFound?: boolean;
		objId?: string;
		msgIsBroken?: boolean;
	}
	
	interface ServLocException extends RuntimeException {
		address: string;
		domainNotFound?: boolean;
		noServiceRecord?: boolean;
	}
	
	interface ASMailSendException extends RuntimeException {
		address: string;
		unknownRecipient?: boolean;
		senderNotAllowed?: boolean;
		inboxIsFull?: boolean;
		badRedirect?: boolean;
		authFailedOnDelivery?: boolean;
		msgTooBig?: boolean;
		allowedSize?: number;
	}
	
	interface Exception extends InboxException, ServLocException,
		ASMailSendException {}
	
}
