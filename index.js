const core = require('@actions/core');
const glob = require('@actions/glob');
const nfetch = require('node-fetch');
const formData = require('form-data');
const fs = require('fs');

function getUrl(apiUrl, serverId, endpoint) {
    return apiUrl + '/client/servers/' + serverId + endpoint;
}

function filenamesToRegex(filenames) {
    filenames = filenames.map(filename => {
        return filename.replace(/([()\[\]^$+*?.])/g, '\\$&');
    });
    let regex = filenames.join('|')
    return new RegExp(regex);
}

async function main(onError) {
    // Inputs
    const apiUrl = core.getInput('apiUrl', {required: true});
    const apiKey = core.getInput('apiKey', {required: true});
    const serverId = core.getInput('serverId', {required: true});
    const uploadPath = core.getInput('uploadPath', {required: true});
    const artifactGlob = core.getInput('artifact', {required: true});
    const oldArtifactPattern = core.getInput('oldArtifact', {required: true});

    // Create the headers
    const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
    };

    const uploadArtifacts = (url, artifacts) => {
        const fd = new formData();
        let buffers = artifacts.map(artifact => fs.createReadStream(artifact));
        buffers.forEach(buffer => fd.append('files', buffer));
        console.log('Uploading artifacts');
        nfetch(url, {method: 'POST', body: fd}).then(res => {
            if (res.errors != undefined && res.errors != null) {
                return onError(res.errors);
            }
            console.log('Uploaded artifacts');
        });
    }
    const getUploadUrl = (artifacts) => {
        console.log('Getting upload URL');
        nfetch(getUrl(apiUrl, serverId, '/files/upload'), {headers})
            .then(res => res.json())
            .then(json => {
                if (json.errors != undefined && json.errors != null) {
                    return onError(json.errors);
                }
                let url = json.attributes.url + '&directory=' + encodeURIComponent(uploadPath);
                uploadArtifacts(url, artifacts);
            });
    }
    const deleteFiles = (files, artifacts) => {
        console.log('Deleting ' + files.length + ' file(s)');

        // Very cursed, didn't work other way
        files = files.map(file => '"' + file + '"').join(",");
        let body = `{"root": "${uploadPath}", "files": [${files}]}`

        nfetch(getUrl(apiUrl, serverId, '/files/delete'), {
            headers,
            method: 'POST',
            body
        }).then(res => {
                if (res.errors != undefined && res.errors != null) {
                    return onError(res.errors);
                }
                getUploadUrl(artifacts);
            });
    }
    const listFiles = (regex, artifacts) => {
        console.log('Listing files');
        nfetch(getUrl(apiUrl, serverId, '/files/list') + '?directory='
        + encodeURIComponent(uploadPath), {headers})
            .catch(err => onError(err))
            .then(res => res.json())
            .then(json => {
                if (json.errors != undefined && json.errors != null) {
                    return onError(json.errors);
                }
                const files = json.data.map(fileObj => fileObj.attributes.name)
                    .filter(filename => regex.test(filename));
                if (files.length > 0) {
                    deleteFiles(files, artifacts);
                } else {
                    getUploadUrl(artifacts);
                }
            });
    }
    const printInfo = (oldArtifactRegex, artifacts) => {
        // Print information
        console.log('Using api at ' + apiUrl);
        console.log('The artifact(s) will be uploaded to ' + uploadPath);
        console.log('There is(are) ' + artifacts.length + ' artifact(s) that will be uploaded');
        console.log(artifacts);
        console.log('The old artifact regex is \'' + oldArtifactRegex.source + '\'');
        listFiles(oldArtifactRegex, artifacts);
    }
    const createOldArtifactRegex = (artifacts) => {
        let regex;
        if (oldArtifactPattern != '') {
            regex = new RegExp(oldArtifactPattern);
        } else {
            regex = filenamesToRegex(artifacts);
        }
        printInfo(regex, artifacts);
    }
    const getArtifacts = async () => {
        const globber = await glob.create(artifactGlob);
        const files = await globber.glob();
        if (files.length <= 0) {
            return onError(new Error('No artifacts found!'));
        }
        createOldArtifactRegex(files);
    }

    getArtifacts();
}

main((err) => {
    core.setFailed(err);
});
