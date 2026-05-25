// Graph clients: LocalGraphClient for in-process harness runs, HttpGraphClient
// for a running `codragraph serve` instance.

export { LocalGraphClient, type LocalGraphClientOptions } from './local-client.js';
export { HttpGraphClient, type HttpGraphClientOptions } from './http-client.js';
