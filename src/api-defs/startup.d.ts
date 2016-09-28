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


declare namespace Web3N.Startup {
	
	/**
	 * This is a collection of functions, that are are used by startup
	 * functionality, when user creates new account in 3NWeb domains.
	 */
	interface SignUpService {
		
		/**
		 * @param name is a part of address that comes before @domain
		 * @return a promise, resolvable to an array of available 3NWeb addresses
		 * with a given name part of the address.
		 * Array will be empty, when there are no available addresses for a given
		 * name.
		 */
		getAvailableAddresses(name: string): Promise<string[]>;
		
		/**
		 * @param userId
		 * @return a promise, resolvable to flag that indicates whether an account
		 * for given user has been created (true value), or not (false value).
		 */
		addUser(userId: string): Promise<boolean>;
		
		/**
		 * @param userId
		 * @return a promise, resolvable to flag that indicates whether given user
		 * account is active (true value), or not (false value).
		 */
		isActivated(userId: string): Promise<boolean>;
		
		/**
		 * @param pass
		 * @param progressCB is a callback for progress notification
		 * @return a promise, resolvable when MailerId secret key for login, has
		 * been derived from a password.
		 */
		createMailerIdParams(pass: string,
			progressCB: (progress: number) => void): Promise<void>;
		/**
		 * @param pass
		 * @param progressCB is a callback for progress notification
		 * @return a promise, resolvable when storage secret key, has been derived
		 * from a password.
		 */
		createStorageParams(pass: string,
			progressCB: (progress: number) => void): Promise<void>;
		
	}
	
	/**
	 * This is a collection of functions, that are are used by startup
	 * functionality, when user signs into existing account, whether already
	 * cached on this device, or not.
	 */
	interface SignInService {
		
		/**
		 * @return array of user ids, found on the cached on the disk.
		 */
		getUsersOnDisk(): Promise<string[]>;
		
		/**
		 * @param address
		 * @return a promise, resolvable either to true, if provisioning has started,
		 * or to false, if given address is not known to the MailerId server.
		 */
		startMidProvisioning(address: string): Promise<boolean>;
		
		/**
		 * @param pass is a MailerId login password
		 * @param progressCB is a callback for progress notification
		 * @return a promise, resolvable either to true, if provisioning is done,
		 * or to false, if given password was not accepted.
		 */
		completeMidProvisioning(pass: string,
			progressCB: (progress: number) => void): Promise<boolean>;
		
		/**
		 * @param address is user's login address, required when starting up from
		 * an existing local storage.
		 * @param pass is a storage password
		 * @param progressCB is a callback for progress notification
		 * @return a promise, resolvable either to true, if password opens storage,
		 * or to false, if given password is incorrect.
		 */
		setupStorage(address: string, pass: string,
			progressCB: (progress: number) => void): Promise<boolean>;
		
	}
	
}
