import { listLogs } from '../../../src/api/admin.js';
import { methodNotAllowed } from '../../../src/response.js';

export const onRequestGet = ({ request, env }) => listLogs(request, env);
export const onRequest = () => methodNotAllowed();
