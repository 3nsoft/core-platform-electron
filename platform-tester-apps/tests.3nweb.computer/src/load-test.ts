
import { addMsgToPage, ClosingParams } from './test-page-utils.js';

declare const w3n: web3n.testing.CommonW3N;

(async () => {
	const { userId, userNum } = await w3n.testStand.staticTestInfo();
	if (userNum == 1) {
		(window as any).closeW3NAfterTests = {
			waitSecs: 15
		} as ClosingParams;
		addMsgToPage(`Main test user '${userId}'`);
		document.getElementById('cancel-autoclose')!.hidden = false;
		await import('./tests/mailerid.js');
		await import('./tests/storage.js');
		await import('./tests/asmail.js');
	} else {
		(window as any).skipW3NTests = true;
		addMsgToPage(`Secondary test user '${userId}'`);
		const { setupSecondUserASMailTestReactions } = await import(
			'./tests/asmail/second-user.js'
		);
		await setupSecondUserASMailTestReactions();
	}
})();
