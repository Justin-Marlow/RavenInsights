window.STREAM_GAGE_STATIONS = [
  {
    id: 'moize-creek',

    name: 'Moize Creek',

    shortName: 'Moize Creek',

    description:
      'WTRBA stream gage',

    referenceElevation: 100.0,

    water: {
      unit: 'ft',
      decimals: 2
    },

    battery: {
      unit: '%',
      decimals: 0,
      multiplier: 1
    },

    status: {
      delayedMinutes: 90,
      offlineMinutes: 180
    },

    thresholds: {
      action: null,
      flood: null
    }
  },

  {
    id: 'mffd-threeway',

    name: 'MFFD: Threeway',

    shortName: 'MFFD Threeway',

    description:
      'Demonstration station using the Moize Creek data stream',

    referenceElevation: 150.0,

    water: {
      unit: 'ft',
      decimals: 2
    },

    battery: {
      unit: '%',
      decimals: 0,
      multiplier: 1
    },

    status: {
      delayedMinutes: 90,
      offlineMinutes: 180
    },

    thresholds: {
      action: null,
      flood: null
    }
  }
];