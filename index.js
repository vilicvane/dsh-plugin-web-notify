/**
 * Web notification plugin, host half.
 *
 * The empty apply exists so the plugin appears in the host cordis.yml /
 * Loader; the browser half owns the notification behavior through
 * exports["./client"], discovered from the package.json dsh.client
 * declaration.
 */
function apply() {}

export {apply};
