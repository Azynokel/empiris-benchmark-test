import { main } from '../src/main';

// Read first argument from command line as the path to the config_file
const config = process.argv[2];

console.log(config);

main(config).catch(console.error);