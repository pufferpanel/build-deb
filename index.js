const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const io = require('@actions/io');
const path = require("path");
const fs = require("fs");
const crypto = require('crypto');
const os = require("os");

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

        //there can be an annoying issue where perms aren't right... just reset now
        const username = os.userInfo().username;
        await exec.exec('/bin/sh', ['-c', `sudo chown -R ${username}:${username} .`], {cwd: dataFolder});

        const allFiles = getFiles(dataFolder);

        //create supplement files for handling the debian aspect
        const debianDir = path.join(dataFolder, "DEBIAN")
        if (fs.existsSync(debianDir)) {
            fs.rmdirSync(debianDir, {recursive: true});
        }
        fs.mkdirSync(debianDir);

        //there's several files we need

        //first, we'll do the conffiles. This is a list of files in the /etc folder that we flag as "configs"
        const etcFiles = getFiles(dataFolder, 'etc');
        fs.writeFileSync(path.join(debianDir, "conffiles"), etcFiles.join('\n') + '\n');

        //generate our md5 file
        const md5sumFile = path.join(debianDir, 'md5sums');
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
        fs.writeFileSync(path.join(debianDir, 'control'), `Package: ${packageName}
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
`);

        //generate the scripts
        //at this point, assume there is a script, because the template can handle "empty" values
        let scriptFile = '';
        scriptFile = replaceIn(PREINST, 'before-upgrade', beforeUpgrade);
        scriptFile = replaceIn(scriptFile, 'before-install', beforeInstall);
        fs.writeFileSync(path.join(debianDir, 'preinst'), scriptFile, {mode: '0775'});

        scriptFile = replaceIn(PRERM, 'before-remove', beforeRemove);
        fs.writeFileSync(path.join(debianDir, 'prerm'), scriptFile, {mode: '0775'});

        scriptFile = replaceIn(POSTINST, 'after-upgrade', afterUpgrade);
        scriptFile = replaceIn(scriptFile, 'after-install', afterInstall);
        fs.writeFileSync(path.join(debianDir, 'postinst'), scriptFile, {mode: '0775'});

        scriptFile = replaceIn(POSTRM, 'after-remove', afterRemove);
        scriptFile = replaceIn(scriptFile, 'after-purge', afterPurge);
        fs.writeFileSync(path.join(debianDir, 'postrm'), scriptFile, {mode: '0775'});

        //we have to change file owners so it works okay
        await exec.exec('/bin/sh', ['-c', 'sudo chown -R root:root .'], {cwd: dataFolder});

        const resultFile = path.join(dataFolder, '..', `${packageName}_${version}_${architecture}.deb`);
        //now we can build the package
        await exec.exec('/bin/sh', ['-c', `sudo dpkg -b . ${resultFile}`], {cwd: dataFolder});
        core.setOutput('file', resultFile);

        //reset perms to be what our user is
        await exec.exec('/bin/sh', ['-c', `sudo chown -R ${username}:${username} .`], {cwd: dataFolder});

        //remove our DEBIAN dir
        await exec.exec('/bin/sh', ['-c', 'sudo rm -rf ' + debianDir], {cwd: dataFolder});
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
    upgradeFromVersion="${2}"
    before_upgrade "\${upgradeFromVersion}"
elif [ "\${1}" = "install" -a -n "\${2}" ]
then
    upgradeFromVersion="${2}"
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
