/*
 Copyright (C) 2017 - 2018 3NSoft Inc.

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
 * This is a namespace for things used by ui-related functionality.
 */
declare namespace web3n.ui {

	type OpenChildWindow = (subroot: string|null, path: string,
		opts: WindowOptions, setRPC?: boolean, caps?: any) =>
		Promise<ChildWindow>;
	
	interface ChildWindow {
		rpc?: rpc.RPC;
		destroy(): void;
	}

	type OpenViewer = (fs: files.FS, path: string, itemType: 'file'|'folder',
		opts?: WindowOptions) => Promise<void>;
	
	type OpenItemInFS = (fs: files.FS, path: string, itemType: 'file'|'folder',
	opts?: WindowOptions) => Promise<void>;
	
	type OpenWithOSApp = (fs: files.FS, path: string) => Promise<boolean>;

	/**
	 * These options are a whitelisted subset of options for Electron's window.
	 * Note that comments are taken from Electron verbatim.
	 */
	interface WindowOptions {
		/**
		 * Window’s width in pixels.
		 * Default: 800.
		 */
		width?: number;
		/**
		 * Window’s height in pixels.
		 * Default: 600.
		 */
		height?: number;
		/**
		 * Window’s left offset from screen.
		 * Default: center the window.
		 */
		x?: number;
		/**
		 * Window’s top offset from screen.
		 * Default: center the window.
		 */
		y?: number;
		/**
		 * The width and height would be used as web page’s size, which means
		 * the actual window’s size will include window frame’s size and be slightly larger.
		 * Default: false.
		 */
		useContentSize?: boolean;
		/**
		 * Show window in the center of the screen.
		 * Default: true
		 */
		center?: boolean;
		/**
		 * Window’s minimum width.
		 * Default: 0.
		 */
		minWidth?: number;
		/**
		 * Window’s minimum height.
		 * Default: 0.
		 */
		minHeight?: number;
		/**
		 * Window’s maximum width.
		 * Default: no limit.
		 */
		maxWidth?: number;
		/**
		 * Window’s maximum height.
		 * Default: no limit.
		 */
		maxHeight?: number;
		/**
		 * Whether window is resizable.
		 * Default: true.
		 */
		resizable?: boolean;
		/**
		 * Whether window is movable.
		 * Note: This is not implemented on Linux.
		 * Default: true.
		 */
		movable?: boolean;
		/**
		 * Whether window is minimizable.
		 * Note: This is not implemented on Linux.
		 * Default: true.
		 */
		minimizable?: boolean;
		/**
		 * Whether window is maximizable.
		 * Note: This is not implemented on Linux.
		 * Default: true.
		 */
		maximizable?: boolean;
		/**
		 * Whether to show the window in taskbar.
		 * Default: false.
		 */
		skipTaskbar?: boolean;
		/**
		 * Default window title.
		 * Default: "Electron".
		 */
		title?: string;
		/**
		 * The window icon, when omitted on Windows the executable’s icon would be used as window icon.
		 */
		icon?: string;
		/**
		 * Specify false to create a Frameless Window.
		 * Default: true.
		 */
		frame?: boolean;
		/**
		 * If window is not modal, specifies if it should still stay atop of a parent. Ignored for modal window.
		 * Default: false.
		 * (Non-Electron flag)
		 */
		alwaysAboveParent?: boolean;
		/**
		 * Whether this is a modal window. This only works when the window is a child window.
		 * Default: false.
		 */
		modal?: boolean;
		/**
		 * Whether the web view accepts a single mouse-down event that simultaneously activates the window.
		 * Default: false.
		 */
		acceptFirstMouse?: boolean;
		/**
		 * Window’s background color as Hexadecimal value, like #66CD00 or #FFF or #80FFFFFF (alpha is supported).
		 * Default: #FFF (white).
		 */
		backgroundColor?: string;
		/**
		 * The style of window title bar.
		 */
		titleBarStyle?: 'default' | 'hidden' | 'hidden-inset';
		/**
		 * Use WS_THICKFRAME style for frameless windows on Windows
		 */
		thickFrame?: boolean;
	}
	
}