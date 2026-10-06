import { createDriveHandler } from '../drive-server.mjs';
export const config = { api: { bodyParser: false } };
export default createDriveHandler();
