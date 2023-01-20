"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function timeoutPromise(promise, ms, timeoutError = new Error('Promise timed out')) {
    // create a promise that rejects in milliseconds
    const timeout = new Promise((_, reject) => {
        setTimeout(() => {
            reject(timeoutError);
        }, ms);
    });
    // returns a race between timeout and the passed promise
    return Promise.race([promise, timeout]);
}
exports.default = timeoutPromise;
//# sourceMappingURL=timeoutPromise.js.map