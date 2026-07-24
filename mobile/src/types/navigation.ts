export type RootStackParamList = {
  GuestTabs: undefined;
  CustomerTabs: undefined;
  AdminTabs: undefined;
  Login: undefined;
  Register: undefined;
  PublicActions: { publicId?: string };
};

export type GuestTabParamList = {
  Home: undefined;
  Booking: { preselectedService?: string; preselectedBarber?: string };
  Catalog: undefined;
  Lookbook: undefined;
};

export type CustomerTabParamList = {
  CustomerAppointments: undefined;
  NewBooking: undefined;
  CustomerCatalog: undefined;
};

export type AdminTabParamList = {
  AdminAppointments: undefined;
  AdminCatalog: undefined;
  AdminSchedules: undefined;
  AdminNotifications: undefined;
};
