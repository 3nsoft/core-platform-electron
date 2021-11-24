
export function addMsgToPage(msg: string): void {
	const outElem = document.getElementById('test-out') as HTMLDivElement|null;
	if (outElem) {
		const txt = document.createTextNode(msg);
		const p = document.createElement('p');
		p.appendChild(txt);
		outElem.appendChild(p);
	} else {
		console.error(`Element for test messages is not found to display following:`, msg);
	}
}

export function progressOnPage(p: number): void {
	const progressElem = document.getElementById(
		'keys-process') as HTMLProgressElement|null;
	if (progressElem) {
		progressElem.hidden = false;
		progressElem.value = p;
	} else {
		console.error(`Progress element is not found to display percent:`, p);
	}
}

export async function getUserCreds(userNum: number): Promise<UserCreds> {
	const resp = await fetch(`./creds-${userNum}.json`);
	const creds = await resp.json() as UserCreds;
	const atInd = creds.userId.indexOf('@');
	if (atInd < 1) { throw new Error(`User id is bad ${creds.userId}`); }
	return creds;
}

export async function signUpOrLogIn(userNum: number): Promise<void> {
	const w3n = (window as any).w3n as web3n.startup.W3N;
	const creds = await getUserCreds(userNum);
	if (await userExists(creds)) {
		await loginUser(creds);
	} else {
		await createUser(creds);
	}

}

async function userExists(creds: UserCreds): Promise<boolean> {
	const w3n = (window as any).w3n as web3n.startup.W3N;
	const name = creds.userId.substring(0, creds.userId.indexOf('@'));
	const addresses = await w3n.signUp.getAvailableAddresses(name);
	return !addresses.find(addr => (addr === creds.userId));
}

async function createUser(creds: UserCreds): Promise<void> {
	const w3n = (window as any).w3n as web3n.startup.W3N;
	addMsgToPage(`User '${creds.userId}' doesn't exist, and is being created now`);
	await w3n.signUp.createUserParams(creds.pass, progressOnPage);
	const isCreated = await w3n.signUp.addUser(creds.userId);
	if (!isCreated) {
		throw await logErr(`Failed to create test user '${creds.userId}'`);
	} else {
		addMsgToPage(`Created test user '${creds.userId}' and going switch to next app`);
	}
}

export async function logErr(msg: string, err?: any): Promise<any> {
	const w3n = (window as any).w3n as web3n.startup.W3N;
	await w3n.log!('error', msg, err);
	addMsgToPage(msg);
	if (err) {
		return err;
	} else {
		return Error(msg);
	}
}

async function loginUser(creds: UserCreds): Promise<void> {
	const w3n = (window as any).w3n as web3n.startup.W3N;
	const users = await w3n.signIn.getUsersOnDisk();
	let passOK: boolean;
	if (users.find(addr => (addr === creds.userId))) {
		addMsgToPage(`User files are present on a disk. Logging in.`);
		passOK = await w3n.signIn.useExistingStorage(
			creds.userId, creds.pass, progressOnPage);
	} else {
		addMsgToPage(`Disk cache doesn't have user files.`);
		if (!(await w3n.signIn.startLoginToRemoteStorage(creds.userId))) {
			throw await logErr(`Test user '${creds.userId}' is not known`);
		}
		await w3n.signIn.startLoginToRemoteStorage(creds.userId);
		passOK = await w3n.signIn.completeLoginAndLocalSetup(
			creds.pass, progressOnPage);
	}
	if (!passOK) {
		throw await logErr(`Login failed`);
	}
}

export async function getLoggedUserNum(
	userId: string, maxUserNum: number
): Promise<number> {
	for (let userNum=1; userNum<=maxUserNum; userNum+=1) {
		try {
			const creds = await getUserCreds(userNum);
			if (creds.userId === userId) { return userNum; }
		} catch (err) {
			throw await logErr(`Error occured when looking for user number of '${userId}'`, err);
		}
	}
	throw await logErr(`User number for id '${userId}' is not found`);
}

export interface ClosingParams {
	waitSecs: number;
	closeOtherApps: () => Promise<void>;
}

export async function getTestUsersOrdered(): Promise<string[]> {
	const numOfUsers = 2;
	const users: string[] = [];
	for (let userNum=1; userNum<=numOfUsers; userNum+=1) {
		const creds = await getUserCreds(userNum);
		users.push(creds.userId);
	}
	return users;
}

