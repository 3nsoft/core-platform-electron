
import { getLoggedUserNum, addMsgToPage, ClosingParams } from './test-page-utils.js';
import {  sendCloseSignalToAllUsers, setupAppClosingOnSignal } from './test-apps-signalling.js';

(async () => {
	const userId = await w3n.mailerid!.getUserId();
	const userNum = await getLoggedUserNum(userId, 2);
	if (userNum == 1) {
		(window as any).closeW3NAfterTests = {
			waitSecs: 15,
			closeOtherApps: sendCloseSignalToAllUsers
		} as ClosingParams;
		addMsgToPage(`Main test user '${userId}'`);
		await import('./tests/mailerid.js');
		await import('./tests/storage.js');
		await import('./tests/asmail.js');
	} else {
		(window as any).skipW3NTests = true;
		(window as any).closeW3NAfterTests = true;
		setupAppClosingOnSignal(2*60);
		addMsgToPage(`Secondary test user '${userId}'`);
		const { setupSecondUserASMailTestReactions } = await import(
			'./tests/asmail/second-user.js'
		);
		setupSecondUserASMailTestReactions();
	}
})();
