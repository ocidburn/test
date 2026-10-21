// expo-notifications' config plugin is applied automatically on prebuild and
// adds the push entitlement (aps-environment). This app only schedules local
// notifications, and a free Apple ID cannot sign the push entitlement, so it
// is removed again here.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
