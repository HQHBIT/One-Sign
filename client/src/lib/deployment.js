// Which organisation this box serves, as declared by /auth/config — set once
// by App before anyone signs in. Use this, not user.orgId, to gate an
// organisation's features: users created on the WAQF box before org_id was set
// on insert still read as 'hqhb'.
let org = null;

export function setDeploymentOrg(id) { org = id || null; }
export const deploymentOrg = () => org;
export const isHqhbBox = () => org === "hqhb";
