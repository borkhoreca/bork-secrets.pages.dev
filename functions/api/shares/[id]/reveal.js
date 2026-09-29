import { revealShare } from '../../../../src/api/shares.js';
import { methodNotAllowed } from '../../../../src/response.js';

export const onRequestPost = ({ request, env, params }) => revealShare(request, env, params.id);
export const onRequest = () => methodNotAllowed();
