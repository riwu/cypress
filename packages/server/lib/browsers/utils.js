"use strict";
const tslib_1 = require("tslib");
/* eslint-disable no-redeclare */
const bluebird_1 = tslib_1.__importDefault(require("bluebird"));
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const errors = tslib_1.__importStar(require("../errors"));
const plugins = tslib_1.__importStar(require("../plugins"));
const errors_1 = require("@packages/errors");
const launcher = tslib_1.__importStar(require("@packages/launcher"));
const path = require('path');
const debug = require('debug')('cypress:server:browsers:utils');
const getPort = require('get-port');
const { fs } = require('../util/fs');
const extension = require('@packages/extension');
const appData = require('../util/app_data');
const profileCleaner = require('../util/profile_cleaner');
const { telemetry } = require('@packages/telemetry');
const pathToBrowsers = appData.path('browsers');
const legacyProfilesWildcard = path.join(pathToBrowsers, '*');
const getAppDataPath = (browser) => {
    if (!browser || !browser.profilePath) {
        return pathToBrowsers;
    }
    return path.join(browser.profilePath, 'Cypress');
};
const getProfileWildcard = (browser) => {
    return path.join(getAppDataPath(browser), '*');
};
const getBrowserPath = (browser) => {
    // TODO need to check if browser.name is an unempty string
    return path.join(getAppDataPath(browser), `${browser.name}-${browser.channel}`);
};
const getMajorVersion = (version) => {
    return parseFloat(version.split('.')[0]) || version;
};
const defaultLaunchOptions = {
    preferences: {},
    extensions: [],
    args: [],
    env: {},
};
const KNOWN_LAUNCH_OPTION_PROPERTIES = lodash_1.default.keys(defaultLaunchOptions);
const getDefaultLaunchOptions = (options) => {
    return lodash_1.default.defaultsDeep(options, defaultLaunchOptions);
};
const copyExtension = (src, dest) => {
    return fs.copyAsync(src, dest);
};
const getPartition = function (isTextTerminal) {
    if (isTextTerminal) {
        return `run-${process.pid}`;
    }
    return 'interactive';
};
const getProfileDir = (browser, isTextTerminal) => {
    return path.join(getBrowserPath(browser), getPartition(isTextTerminal));
};
const getExtensionDir = (browser, isTextTerminal) => {
    return path.join(getProfileDir(browser, isTextTerminal), 'CypressExtension');
};
const ensureCleanCache = async function (browser, isTextTerminal) {
    const p = path.join(getProfileDir(browser, isTextTerminal), 'CypressCache');
    await fs.removeAsync(p);
    await fs.ensureDirAsync(p);
    return p;
};
// we now store profiles inside the Cypress binary folder
// so we need to remove the legacy root profiles that existed before
function removeLegacyProfiles() {
    return profileCleaner.removeRootProfile(legacyProfilesWildcard, [
        path.join(legacyProfilesWildcard, 'run-*'),
        path.join(legacyProfilesWildcard, 'interactive'),
    ]);
}
const removeOldProfiles = function (browser) {
    // a profile is considered old if it was used
    // in a previous run for a PID that is either
    // no longer active, or isnt a cypress related process
    const pathToPartitions = appData.electronPartitionsPath();
    return bluebird_1.default.all([
        removeLegacyProfiles(),
        profileCleaner.removeInactiveByPid(getProfileWildcard(browser), 'run-'),
        profileCleaner.removeInactiveByPid(pathToPartitions, 'run-'),
    ]);
};
const pathToExtension = extension.getPathToExtension();
async function executeBeforeBrowserLaunch(browser, launchOptions, options) {
    if (plugins.has('before:browser:launch')) {
        const span = telemetry.startSpan({ name: 'lifecycle:before:browser:launch' });
        span === null || span === void 0 ? void 0 : span.setAttribute({
            name: browser.name,
            channel: browser.channel,
            version: browser.version,
            isHeadless: browser.isHeadless,
        });
        const pluginConfigResult = await plugins.execute('before:browser:launch', browser, launchOptions);
        span === null || span === void 0 ? void 0 : span.end();
        if (pluginConfigResult) {
            extendLaunchOptionsFromPlugins(launchOptions, pluginConfigResult, options);
        }
    }
    return launchOptions;
}
function extendLaunchOptionsFromPlugins(launchOptions, pluginConfigResult, options) {
    // if we returned an array from the plugin
    // then we know the user is using the deprecated
    // interface and we need to warn them
    // TODO: remove this logic in >= v5.0.0
    if (pluginConfigResult[0]) {
        // eslint-disable-next-line no-console
        (options.onWarning || console.warn)((0, errors_1.getError)('DEPRECATED_BEFORE_BROWSER_LAUNCH_ARGS'));
        lodash_1.default.extend(pluginConfigResult, {
            args: lodash_1.default.filter(pluginConfigResult, (_val, key) => {
                return lodash_1.default.isNumber(key);
            }),
            extensions: [],
        });
    }
    else {
        // either warn about the array or potentially error on invalid props, but not both
        // strip out all the known launch option properties from the resulting object
        const unexpectedProperties = lodash_1.default
            .chain(pluginConfigResult)
            .omit(KNOWN_LAUNCH_OPTION_PROPERTIES)
            .keys()
            .value();
        if (unexpectedProperties.length) {
            errors.throwErr('UNEXPECTED_BEFORE_BROWSER_LAUNCH_PROPERTIES', unexpectedProperties, KNOWN_LAUNCH_OPTION_PROPERTIES);
        }
    }
    lodash_1.default.forEach(launchOptions, (val, key) => {
        const pluginResultValue = pluginConfigResult[key];
        if (pluginResultValue) {
            if (lodash_1.default.isPlainObject(val)) {
                launchOptions[key] = lodash_1.default.extend({}, launchOptions[key], pluginResultValue);
                return;
            }
            launchOptions[key] = pluginResultValue;
            return;
        }
    });
    return launchOptions;
}
const wkBrowserVersionRe = /BROWSER_VERSION = \'(?<version>[^']+)\'/gm;
const getWebKitBrowserVersion = async () => {
    try {
        // this seems to be the only way to accurately capture the WebKit version - it's not exported, and invoking the webkit binary with `--version` does not give the correct result
        // after launching the browser, this is available at browser.version(), but we don't have a browser instance til later
        const pwCorePath = path.dirname(require.resolve('playwright-core', { paths: [process.cwd()] }));
        const wkBrowserPath = path.join(pwCorePath, 'lib', 'server', 'webkit', 'wkBrowser.js');
        const wkBrowserContents = await fs.readFile(wkBrowserPath);
        const result = wkBrowserVersionRe.exec(wkBrowserContents);
        if (!result || !result.groups.version)
            return '0';
        return result.groups.version;
    }
    catch (err) {
        debug('Error detecting WebKit browser version %o', err);
        return '0';
    }
};
async function getWebKitBrowser() {
    try {
        const modulePath = require.resolve('playwright-webkit', { paths: [process.cwd()] });
        const mod = await Promise.resolve().then(() => tslib_1.__importStar(require(modulePath)));
        const version = await getWebKitBrowserVersion();
        const browser = {
            name: 'webkit',
            channel: 'stable',
            family: 'webkit',
            displayName: 'WebKit',
            version,
            path: mod.webkit.executablePath(),
            majorVersion: version.split('.')[0],
            warning: 'WebKit support is currently experimental. Some functions may not work as expected.',
        };
        return browser;
    }
    catch (err) {
        debug('WebKit is enabled, but there was an error constructing the WebKit browser: %o', { err });
        return;
    }
}
const getBrowsers = async () => {
    debug('getBrowsers');
    const [browsers, wkBrowser] = await Promise.all([
        launcher.detect(),
        getWebKitBrowser(),
    ]);
    if (wkBrowser)
        browsers.push(wkBrowser);
    debug('found browsers %o', { browsers });
    if (!process.versions.electron) {
        debug('not in electron, skipping adding electron browser');
        return browsers;
    }
    const version = process.versions.chrome || '';
    let majorVersion;
    if (version) {
        majorVersion = getMajorVersion(version);
    }
    const electronBrowser = {
        name: 'electron',
        channel: 'stable',
        family: 'chromium',
        displayName: 'Electron',
        version,
        path: '',
        majorVersion,
    };
    browsers.push(electronBrowser);
    return browsers;
};
const isValidPathToBrowser = (str) => {
    return path.basename(str) !== str;
};
const parseBrowserOption = (opt) => {
    // it's a name or a path
    if (!lodash_1.default.isString(opt) || !opt.includes(':')) {
        return {
            name: opt,
            channel: 'stable',
        };
    }
    // it's in name:channel format
    const split = opt.indexOf(':');
    return {
        name: opt.slice(0, split),
        channel: opt.slice(split + 1),
    };
};
async function ensureAndGetByNameOrPath(nameOrPath, returnAll = false, prevKnownBrowsers = []) {
    const browsers = prevKnownBrowsers.length ? prevKnownBrowsers : (await getBrowsers());
    const filter = parseBrowserOption(nameOrPath);
    debug('searching for browser %o', { nameOrPath, filter, knownBrowsers: browsers });
    // try to find the browser by name with the highest version property
    const sortedBrowsers = lodash_1.default.sortBy(browsers, ['version']);
    const browser = lodash_1.default.findLast(sortedBrowsers, filter);
    if (browser) {
        // short circuit if found
        if (returnAll) {
            return browsers;
        }
        return browser;
    }
    // did the user give a bad name, or is this actually a path?
    if (isValidPathToBrowser(nameOrPath)) {
        // looks like a path - try to resolve it to a FoundBrowser
        return launcher.detectByPath(nameOrPath)
            .then((browser) => {
            if (returnAll) {
                return [browser].concat(browsers);
            }
            return browser;
        }).catch((err) => {
            errors.throwErr('BROWSER_NOT_FOUND_BY_PATH', nameOrPath, err.message);
        });
    }
    // not a path, not found by name
    throwBrowserNotFound(nameOrPath, browsers);
}
const formatBrowsersToOptions = (browsers) => {
    return browsers.map((browser) => {
        if (browser.channel !== 'stable') {
            return [browser.name, browser.channel].join(':');
        }
        return browser.name;
    });
};
const throwBrowserNotFound = function (browserName, browsers = []) {
    return errors.throwErr('BROWSER_NOT_FOUND_BY_NAME', browserName, formatBrowsersToOptions(browsers));
};
module.exports = {
    extendLaunchOptionsFromPlugins,
    executeBeforeBrowserLaunch,
    defaultLaunchOptions,
    getDefaultLaunchOptions,
    getPort,
    copyExtension,
    getBrowserPath,
    getMajorVersion,
    getProfileDir,
    getExtensionDir,
    ensureCleanCache,
    removeOldProfiles,
    ensureAndGetByNameOrPath,
    getBrowsers,
    formatBrowsersToOptions,
    throwBrowserNotFound,
    writeExtension(browser, isTextTerminal, proxyUrl, socketIoRoute) {
        debug('writing extension');
        // debug('writing extension to chrome browser')
        // get the string bytes for the final extension file
        return extension.setHostAndPath(proxyUrl, socketIoRoute)
            .then((str) => {
            const extensionDest = getExtensionDir(browser, isTextTerminal);
            const extensionBg = path.join(extensionDest, 'background.js');
            // copy the extension src to the extension dist
            return copyExtension(pathToExtension, extensionDest)
                .then(() => {
                debug('copied extension');
                // ensure write access before overwriting
                return fs.chmod(extensionBg, 0o0644);
            })
                .then(() => {
                // and overwrite background.js with the final string bytes
                return fs.writeFileAsync(extensionBg, str);
            })
                .return(extensionDest);
        });
    },
};
