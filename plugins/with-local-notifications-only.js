const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * HomeyPaw 1.0 schedules local notifications only. expo-notifications adds the
 * remote-push aps-environment entitlement by default, which cannot be signed
 * by an Apple Personal Team and is unnecessary for local notifications.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    delete configWithEntitlements.modResults['aps-environment'];

    return configWithEntitlements;
  });
};
