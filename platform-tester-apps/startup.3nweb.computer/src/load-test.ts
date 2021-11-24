
import { addMsgToPage } from './test-page-utils.js';

(async () => {
	const userNum = await getUserNum();
	if (userNum == 1) {
		await import("./signup.js");
	} else {
		(window as any).skipW3NTests = true;
		const { signUpOrLogIn } = await import('./test-page-utils.js');
		addMsgToPage(`Second user`);
		await signUpOrLogIn(userNum);
	}
})();
