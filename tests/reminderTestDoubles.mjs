const emptySync = () => ({ permissionGranted: false, scheduled: 0, cancelled: 0, unscheduled: 0, stateUpdates: [] });

export const reminderNativeNotifications = {
  addReminderReceivedListener: () => () => {},
  localReminderScheduler: {
    async requestPermission() { return false; },
    async reconcileNotes() { return emptySync(); },
    async reconcilePrivateNotes() { return emptySync(); },
    async schedulePrivateSummary() { return { scheduled: 0, cancelled: 0, unscheduled: 0 }; },
    async cancelPrivateReminder() { return 0; },
    async cancelNoteReminder() { return 0; },
  },
};

export const reminderControlsModule = { ReminderControls: 'ReminderControls' };
