module.exports =
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 117:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(895);
const github = __nccwpck_require__(882);
const exec = __nccwpck_require__(894);
const io = __nccwpck_require__(226);
const path = __nccwpck_require__(622);
const fs = __nccwpck_require__(747);
const crypto = __nccwpck_require__(417);
const os = __nccwpck_require__(87);

async function main() {
    try {
        const dataFolder = core.getInput('data-folder');
        const packageName = core.getInput('package');
        const version = core.getInput('version');
        const license = core.getInput('license');
        const architecture = core.getInput('architecture');
        const maintainer = core.getInput('maintainer');
        const homepage = core.getInput('homepage');
        const description = core.getInput('description');
        const beforeInstall = core.getInput('before-install');
        const afterInstall = core.getInput('after-install');
        const beforeUpgrade = core.getInput('before-upgrade');
        const afterUpgrade = core.getInput('after-upgrade');
        const beforeRemove = core.getInput('before-remove');
        const afterRemove = core.getInput('after-remove');
        const afterPurge = core.getInput('after-purge');
        const group = core.getInput('group');
        const user = core.getInput('user');
        const suggestedPackages = getSuggestedPackages();

        //there can be an annoying issue where perms aren't right... just reset now
        const username = os.userInfo().username;
        await exec.exec('/bin/sh', ['-c', `sudo chown -R ${username}:${username} ${dataFolder}`]);

        const allFiles = getFiles(dataFolder);

        //create supplement files for handling the debian aspect
        const debianDir = path.join(dataFolder, "DEBIAN")
        if (fs.existsSync(debianDir)) {
            console.log(`Cleaning up ${debianDir}`);
            fs.rmdirSync(debianDir, {recursive: true});
        }
        console.log(`Creating ${debianDir}`);
        fs.mkdirSync(debianDir);

        //there's several files we need

        //first, we'll do the conffiles. This is a list of files in the /etc folder that we flag as "configs"
        const etcFiles = getFiles(dataFolder, 'etc');
        const conffiles = path.join(debianDir, "conffiles");
        console.log(`Creating ${conffiles}`);
        fs.writeFileSync(conffiles, etcFiles.join('\n') + '\n');

        //generate our md5 file
        const md5sumFile = path.join(debianDir, 'md5sums');
        console.log(`Creating ${md5sumFile}`)
        fs.writeFileSync(md5sumFile, '');
        for(const i in allFiles) {
            const file = allFiles[i];

            if (file.startsWith('/DEBIAN')) {
                continue;
            }
            const buf = fs.readFileSync(path.join(dataFolder, file.slice(1)));
            const hash = crypto.createHash('md5').update(buf).digest("hex");

            fs.appendFileSync(md5sumFile, hash + ' ' + file.slice(1) + '\n');
        }

        //generate the control file
        const controlFile = path.join(debianDir, 'control');
        console.log(`Creating ${controlFile}`);
        fs.writeFileSync(controlFile, `Package: ${packageName}
Version: ${version}
License: ${license}
Vendor: pufferpanel-debbuilder
Architecture: ${architecture}
Maintainer: ${maintainer}
Installed-Size: 0
Section: default
Priority: extra
Homepage: ${homepage}
Description: ${description}
${suggestedPackages}
`);

        //generate the scripts
        //at this point, assume there is a script, because the template can handle "empty" values
        let scriptFile = '';
        scriptFile = replaceIn(PREINST, 'before-upgrade', beforeUpgrade);
        scriptFile = replaceIn(scriptFile, 'before-install', beforeInstall);
        const preinstFile = path.join(debianDir, 'preinst');
        console.log(`Creating ${preinstFile}`);
        fs.writeFileSync(preinstFile, scriptFile, {mode: '0775'});

        scriptFile = replaceIn(PRERM, 'before-remove', beforeRemove);
        const prermFile = path.join(debianDir, 'prerm');
        console.log(`Creating ${prermFile}`);
        fs.writeFileSync(prermFile, scriptFile, {mode: '0775'});

        scriptFile = replaceIn(POSTINST, 'after-upgrade', afterUpgrade);
        scriptFile = replaceIn(scriptFile, 'after-install', afterInstall);
        const postinitFile = path.join(debianDir, 'postinst');
        console.log(`Creating ${postinitFile}`);
        fs.writeFileSync(postinitFile, scriptFile, {mode: '0775'});

        scriptFile = replaceIn(POSTRM, 'after-remove', afterRemove);
        scriptFile = replaceIn(scriptFile, 'after-purge', afterPurge);
        const postrmFile = path.join(debianDir, 'postrm');
        console.log(`Creating ${postrmFile}`);
        fs.writeFileSync(postrmFile, scriptFile, {mode: '0775'});

        //we have to change file owners so it works okay
        await exec.exec('/bin/sh', ['-c', `sudo chown -R root:root ${dataFolder}`]);

        const resultFile = path.resolve(dataFolder, '..', `${packageName}_${version}_${architecture}.deb`);
        //now we can build the package
        await exec.exec('/bin/sh', ['-c', `sudo dpkg -b ${dataFolder} ${resultFile}`]);
        core.setOutput('file', resultFile);

        //reset perms to be what our user is
        await exec.exec('/bin/sh', ['-c', `sudo chown -R ${username}:${username} ${dataFolder}`]);

        //remove our DEBIAN dir
        await exec.exec('/bin/sh', ['-c', `sudo rm -rf ${debianDir}`]);
    } catch (error) {
        core.setFailed(error.message);
    }
}

/**
 *
 * @param root {String}
 * @param item {String}
 * @return {[]}
 */
function getFiles(root, item = '') {
    const result = [];

    fs.readdirSync(path.join(root, item), {withFileTypes: true}).forEach(file => {
        const itemPath = path.join(root, item, file.name).slice(root.length);

        if (file.isDirectory()) {
            const sub = getFiles(root, path.join(item, file.name));
            for(const i in sub) {
                result.push(sub[i]);
            }
        } else {
            result.push(itemPath);
        }
    });
    return result;
}

/**
 *
 * @param data {String}
 * @param key {String}
 * @param file {String}
 * @return {String}
 */
function replaceIn(data, key, file) {
    let fileContents = '';
    if (file && file !== '' && fs.existsSync(file)) {
        fileContents = fs.readFileSync(file).toString();
    }

    return data.replace(`{${key}}`, fileContents);
}

/**
 *
 * @return {String}
 */
function getSuggestedPackages() {
    const packages = core.getInput('suggested-packages').split(/\r?\n/).reduce(
        (acc, line) =>
            acc
                .concat(line.split(','))
                .map(p => p.trim()),
        []
    );

    if (packages.length > 0) {
        return 'Suggests: ' + packages.join(', ');
    }
    return '';
}

const PREINST = `#!/bin/sh
before_upgrade() {
    :
{before-upgrade}
}

before_install() {
    :
{before-install}
}

if [ "\${1}" = "install" -a -z "\${2}" ]
then
    before_install
elif [ "\${1}" = "upgrade" -a -n "\${2}" ]
then
    upgradeFromVersion="\${2}"
    before_upgrade "\${upgradeFromVersion}"
elif [ "\${1}" = "install" -a -n "\${2}" ]
then
    upgradeFromVersion="\${2}"
    before_upgrade "\${upgradeFromVersion}"
elif echo "\${1}" | grep -E -q '(fail|abort)'
then
    echo "Failed to install before the pre-installation script was run." >&2
    exit 1
fi`;

const PRERM = `#!/bin/sh
before_remove() {
    :
{before-remove}
}

dummy() {
    :
}

if [ "\${1}" = "remove" -a -z "\${2}" ]
then
    # "before remove" goes here
    before_remove
elif [ "\${1}" = "upgrade" ]
then
    dummy
elif echo "\${1}" | grep -E -q "(fail|abort)"
then
    echo "Failed to install before the pre-removal script was run." >&2
    exit 1
fi`;

const POSTINST = `#!/bin/sh
after_upgrade() {
    :
{after-upgrade}
}

after_install() {
    :
{after-install}
}

if [ "\${1}" = "configure" -a -z "\${2}" ] || \\
   [ "\${1}" = "abort-remove" ]
then
    after_install
elif [ "\${1}" = "configure" -a -n "\${2}" ]
then
    upgradeFromVersion="\${2}"
    after_upgrade "\${2}"
elif echo "\${1}" | grep -E -q "(abort|fail)"
then
    echo "Failed to install before the post-installation script was run." >&2
    exit 1
fi`;

const POSTRM = `#!/bin/sh
after_remove() {
    :
{after-remove}
}

after_purge() {
    :
{after-purge}
}

dummy() {
    :
}

if [ "\${1}" = "remove" -o "\${1}" = "abort-install" ]
then
    after_remove
elif [ "\${1}" = "purge" -a -z "\${2}" ]
then
    after_purge
elif [ "\${1}" = "upgrade" ]
then
    dummy
elif echo "\${1}" | grep -E -q '(fail|abort)'
then
    echo "Failed to install before the post-removal script was run." >&2
    exit 1
fi`;

main();


/***/ }),

/***/ 895:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 894:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 882:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 226:
/***/ ((module) => {

module.exports = eval("require")("@actions/io");


/***/ }),

/***/ 417:
/***/ ((module) => {

"use strict";
module.exports = require("crypto");;

/***/ }),

/***/ 747:
/***/ ((module) => {

"use strict";
module.exports = require("fs");;

/***/ }),

/***/ 87:
/***/ ((module) => {

"use strict";
module.exports = require("os");;

/***/ }),

/***/ 622:
/***/ ((module) => {

"use strict";
module.exports = require("path");;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	__nccwpck_require__.ab = __dirname + "/";/************************************************************************/
/******/ 	// module exports must be returned from runtime so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	return __nccwpck_require__(117);
/******/ })()
;