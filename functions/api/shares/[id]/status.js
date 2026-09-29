import { getShareStatus } from '../../../../src/api/shares.js';
import { methodNotAllowed } from '../../../../src/response.js';

export const onRequestGet = ({ request, env, params }) => getShareStatus(request, env, params.id);
export const onRequest = () => methodNotAllowed();
