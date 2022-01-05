
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

export async function logErr(msg: string, err?: any): Promise<any> {
	w3n.testStand.log('error', msg, err);
	addMsgToPage(msg);
	if (err) {
		return err;
	} else {
		return Error(msg);
	}
}

export async function logInfo(msg: string): Promise<void> {
	w3n.testStand.log('info', msg);
	addMsgToPage(msg);
}

export interface ClosingParams {
	waitSecs: number;
}
