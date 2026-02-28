const command = new Deno.Command("/tmp/faketerrariaserver.sh", {
    args: ["eval", "console.log('Hello World')"],
    stdin: "piped",
    stdout: "piped",
});
const child = command.spawn();
const stdout = child.stdout.getReader();

let output;
while (true) {
    output = await stdout.read();
    const outputString = new TextDecoder().decode(output.value);
    if (outputString == "") continue;

    const lines = outputString.split("\n");

    for (const line of lines) {
        if (line == "") continue;
        console.log(line);
    }
}
