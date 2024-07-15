export const handler = async (event: any): Promise<any> => {
    try {

        const url = `https://api.github.com/repos/${event['id']}/releases`;
        const version = event?.version ? event.version : undefined
        const ignore_file_s3_url = event?.ignore_file_s3_url ? event.ignore_file_s3_url : undefined

        // fetch is available with Node.js 18
        const res = await fetchWithRetries(url);
        const json = await res.json()
        const release = json[0];

        

        return {
            statusCode: res.status,
            body: {
                id: event['id'],
                last_version: version,
                release: release,
                should_archive: shouldArchive(version, release),
                ignore_file_s3_url: ignore_file_s3_url
            }
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: err
        };
    }
};

function shouldArchive(version: string, release: any) {

    if (!version || !release) {
        return true;
    } else if (!release.tag_name) {
        return true;
    } else {
        return version != release.tag_name;
    }

}

async function fetchWithRetries(url: string, retryCount = 0) {
    // split out the maxRetries option from the remaining
    // options (with a default of 3 retries)
    const maxRetries = 3
    try {
        return await fetch(url);
    } catch (error) {
        // if the retryCount has not been exceeded, call again
        if (retryCount < maxRetries) {
            return await fetchWithRetries(url, retryCount + 1);
        }
        // max retries exceeded
        throw error;
    }
}