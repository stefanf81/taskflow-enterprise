import * as contracts from '@taskflow/schemas/src/generated/api-responses';
import * as validators from '@taskflow/schemas';
import { refine, string } from 'zod/mini';

/**
 * The response validators in @taskflow/schemas are hand-written (they add enums, lengths and the
 * "omitted means empty" defaults), and zod objects drop keys they do not list. If the backend adds
 * a response field, `npm run sync:api-types` regenerates the types and the structural contracts
 * from api/openapi.json, but nothing would tell the validator to keep the new field. This spec
 * does: each validator must list exactly the fields of its generated contract and agree on whether
 * a field may be absent.
 */
type ObjectSchema = {
  shape: Record<string, { safeParse(value: unknown): { success: boolean } }>;
};

/** OpenAPI response DTO -> the hand-written validator that checks it at runtime. */
const VALIDATOR_FOR_CONTRACT: Record<keyof typeof contracts, keyof typeof validators> = {
  appointmentDashboardResponseContract: 'appointmentDashboardResponseSchema',
  appointmentResponseContract: 'appointmentResponseSchema',
  appointmentStatsContract: 'appointmentStatsSchema',
  barberRatingResponseContract: 'barberRatingResponseSchema',
  barberResponseContract: 'barberResponseSchema',
  barberScheduleResponseContract: 'barberScheduleResponseSchema',
  barberTimeOffResponseContract: 'barberTimeOffResponseSchema',
  calendarExportResponseContract: 'calendarExportResponseSchema',
  loginResponseContract: 'loginResponseSchema',
  mobileLoginResponseContract: 'mobileLoginResponseSchema',
  notificationOutboxResponseContract: 'notificationOutboxResponseSchema',
  openingHoursResponseContract: 'openingHoursSchema',
  pageMetadataContract: 'pageMetadataSchema',
  pagedModelAppointmentResponseContract: 'pagedAppointmentResponseSchema',
  publicBarberResponseContract: 'publicBarberResponseSchema',
  registerResponseContract: 'registerResponseSchema',
  scheduleDayContract: 'scheduleDaySchema',
  schedulePreviewResponseContract: 'schedulePreviewResponseSchema',
  serviceItemResponseContract: 'serviceItemResponseSchema',
  shopInfoResponseContract: 'shopInfoResponseSchema',
};

const pairs = Object.entries(VALIDATOR_FOR_CONTRACT) as [
  keyof typeof contracts,
  keyof typeof validators,
][];

type FieldSchema = ObjectSchema['shape'][string];
// Include valid examples for constrained response scalars (role, token type, token and HH:mm).
const probes = ['ROLE_ADMIN', 'Bearer', 'r'.repeat(43), '09:00', 'text', 1, true, [], {}];
const acceptedKinds = (schema: FieldSchema) =>
  new Set(
    probes
      .filter((probe) => schema.safeParse(probe).success)
      .map((probe) => (Array.isArray(probe) ? 'array' : typeof probe)),
  );

function assertFieldTypes(contract: FieldSchema, validator: FieldSchema): void {
  const contractKinds = acceptedKinds(contract);
  const validatorKinds = acceptedKinds(validator);
  // Equality, not subset: a validator that rejects every sample must fail for a scalar contract.
  expect(validatorKinds).toEqual(contractKinds);
}

describe('response validators match the generated OpenAPI contracts', () => {
  it('rejects vacuous validators and wrong primitive types', () => {
    expect(() => assertFieldTypes(string(), string().check(refine(() => false)))).toThrow();
    expect(() =>
      assertFieldTypes(string(), {
        safeParse: (value) => ({ success: typeof value === 'number' }),
      }),
    ).toThrow();
  });
  it('has a validator for every generated contract', () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(VALIDATOR_FOR_CONTRACT).sort());
  });

  it.each(pairs)('%s <-> %s list the same fields', (contractName, validatorName) => {
    const contract = contracts[contractName] as unknown as ObjectSchema;
    const validator = validators[validatorName] as unknown as ObjectSchema;

    expect(Object.keys(validator.shape).sort()).toEqual(Object.keys(contract.shape).sort());
  });

  it.each(pairs)('%s <-> %s agree on which fields may be absent', (contractName, validatorName) => {
    const contract = contracts[contractName] as unknown as ObjectSchema;
    const validator = validators[validatorName] as unknown as ObjectSchema;

    const mayBeAbsent = (schema: ObjectSchema) =>
      Object.fromEntries(
        Object.entries(schema.shape).map(([field, fieldSchema]) => [
          field,
          fieldSchema.safeParse(undefined).success,
        ]),
      );

    expect(mayBeAbsent(validator)).toEqual(mayBeAbsent(contract));
  });

  it.each(pairs)(
    '%s <-> %s agree on primitive field types (string vs number vs boolean vs object/array)',
    (contractName, validatorName) => {
      const contract = contracts[contractName] as unknown as ObjectSchema;
      const validator = validators[validatorName] as unknown as ObjectSchema;

      for (const [field, contractField] of Object.entries(contract.shape)) {
        const validatorField = validator.shape[field];
        expect(validatorField).toBeDefined();
        if (!validatorField) continue;
        assertFieldTypes(contractField, validatorField);
      }
    },
  );
});
