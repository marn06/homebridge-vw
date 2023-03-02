const { exec } = require('child_process');

if (process.platform == 'win32') {
    console.log("Plugin is not configured to run on windows yet")
    return;
}

const commands = [
    'sh ./install.sh'
];

const executedCommands = exec(commands.join('&&'), (error) => {
    if (error) {
        throw error;
    }
});