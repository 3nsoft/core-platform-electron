/*
 Copyright (C) 2018 3NSoft Inc.

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

/// <reference path="../spectron-jasmine-testing.d.ts" />

/**
 * This function creates a setting with potentially many users, and adds
 * jasmine's before-all and after-all that respectively start and stop apps.
 * @param users is an array of mail address, for which user accounts should be
 * created, and apps opened. If missing, a default value will be used, creating
 * one account, and opening one app.
 */
declare function setupWithUsers(users?: string[]): appTesting.MultiUserSetup;
