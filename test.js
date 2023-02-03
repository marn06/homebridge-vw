async function runWithRetry(retryCount, action) {
    let tries = 0;
    while (tries < retryCount) {
        if (await action()) {
            break;
        }
        tries++;
    }
}

runWithRetry(3, async () => {
    return new Promise((resolve, reject) => {
        setTimeout(async (boolean) => {
            console.log("HELLO")
            // Force refresh with get status
            resolve(false);
        }, 1000);
    });
});