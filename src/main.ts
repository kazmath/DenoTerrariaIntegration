import { TextLineStream } from "@std/streams";

const command = new Deno.Command("/tmp/faketerrariaserver.sh", {
    args: ["eval", "console.log('Hello World')"],
    stdin: "piped",
    stdout: "piped",
});
const child = command.spawn();
const stdout = child.stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

const chatMessageRegex: RegExp = /^<(?<player>.*?)> (?<message>.*)$/;
const joinLeftRegex: RegExp = /^(?<player>.*) has (?<type>joined|left)\.$/;
const serverProcessRegex: RegExp =
    /^(?<operation>Saving world data|Validating world save|Backing up world file)(?:: (?<progressPerc>[0-9]{1,3})%)?$/;
const ipOperationsRegex: RegExp =
    /^(?<ipAddr>[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}) (?<verb>is|was) (?<operation>.*?)(?:: (?<details>.*))?$/;

for await (const line of stdout) {
    if (handleChatMessage(line)) continue;
    if (handleJoinLeave(line)) continue;
    if (handleServerProcess(line)) continue;
    if (handleIpOperations(line)) continue;

    console.log(line);
}
console.log("exit");

function handleChatMessage(line: string) {
    const matches = chatMessageRegex.exec(line);

    if (matches == null) return false;
    return true;
}

function handleJoinLeave(line: string) {
    const matches = joinLeftRegex.exec(line);

    if (matches == null) return false;
    return true;
}

function handleServerProcess(line: string) {
    const matches = serverProcessRegex.exec(line);

    if (matches == null) return false;
    return true;
}

function handleIpOperations(line: string) {
    const matches = ipOperationsRegex.exec(line);

    if (matches == null) return false;
    return true;
}
