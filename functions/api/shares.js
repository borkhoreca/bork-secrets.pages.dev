import { createShare } from '../../src/api/shares.js';
import { methodNotAllowed } from '../../src/response.js';

export const onRequestPost = ({ request, env }) => createShare(request, env);
export const onRequest = () => methodNotAllowed();
