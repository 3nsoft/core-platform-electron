/*
 Copyright (C) 2021 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

declare namespace web3n.ui {

	interface Apps {
		opener?: AppsOpener;
		downloader?: AppsDownloader;
		installer?: AppsInstaller;
		platform?: Platform;
	}

	interface AppsOpener {
		listApps(): Promise<AppInfo[]>;
		openApp(id: string, devTools?: boolean): Promise<void>;
		getAppInfo(id: string): Promise<AppInfo|undefined>;
		getAppIcon(id: string): Promise<files.ReadonlyFile>;
	}

	interface AppInfo {
		id: string;
		installed?: {
			platform: PlatformType;
			version: string;
		}[];
		packs?: {
			platform: PlatformType;
			version: string;
		}[];
		bundled?: {
			platform: PlatformType;
			version: string;
			isLink?: true;
		}[];
	}

	type PlatformType = 'web' | 'linux' | 'windows' | 'mac';
	type VariantType = 'zip' | 'unpacked' | 'AppImage' | 'deb' | 'nsis' | 'blockmap' | 'exe' | 'dmg';
	type ArchType = 'src' | 'web' | 'x64' | 'arm64' | 'ia32';

	interface AppsDownloader {
		getAppChannels(id: string): Promise<DistChannels>;
		getLatestAppVersion(id: string, channel: string): Promise<string>;
		getAppVersionList(id: string, version: string): Promise<AppVersionPacks>;
		downloadWebApp(
			id: string, version: string, observer: Observer<DownloadProgress>
		): () => void;
	}

	interface DistChannels {
		channels: {
			[channel: string]: {
				description?: string;
				usage?: 'public' | 'staging';
			};
		};
		main?: string;
	}

	interface AppVersionPacks {
		files: {
			[fName: string]: PackVariant;
		};
	}

	interface PackVariant {
		arch: ArchType;
		variant: VariantType;
	}

	interface DownloadProgress {
		totalFiles: number;
		filesLeft: number;
		totalBytes: number;
		bytesLeft: number;
		fileInProgress?: string;
		currentFileSize?: number;
	}

	interface AppsInstaller {
		unpackBundledWebApp(
			id: string, observer: Observer<BundleUnpackProgress>
		): () => void;
		installWebApp(id: string, version: string): Promise<void>;
		// removeAppData(id: string);
		// removeAppPacks(id: string);
		// uninstallApp(id: string);
	}

	interface BundleUnpackProgress {
		numOfFiles: number;
		numOfProcessed: number;
		fileInProgress?: string;
	}

	interface Platform {
		getCurrentVersion(): Promise<string>;
		getChannels(): Promise<DistChannels>;
		getLatestVersion(channel: string): Promise<string>;
		getVersionList(version: string): Promise<AppVersionPacks>;
		availableUpdateType(): Promise<string|undefined>;
		downloadAndApplyUpdate(
			channel: string, observer: Observer<PlatformDownloadProgress>
		): () => void;
	}

	type PlatformDownloadProgress = {
		event: 'checking-for-update';
	} | {
		event: 'update-available';
		totalSizeMBs: number;
	} | {
		event: 'download-progress';
		percent: number;
	};

}