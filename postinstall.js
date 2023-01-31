const { exec } = require('child_process');

if (process.platform == 'win32') {
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