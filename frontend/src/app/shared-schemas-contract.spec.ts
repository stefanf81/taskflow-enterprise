import * as contracts from '@taskflow/schemas/src/generated/api-responses';
import * as validators from '@taskflow/schemas';

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
  barberTimeOffResponseContract: 'barberTimeOffResponseSchema',
  loginResponseContract: 'loginResponseSchema',
  mobileLoginResponseContract: 'mobileLoginResponseSchema',
  notificationOutboxResponseContract: 'notificationOutboxResponseSchema',
  pageMetadataContract: 'pageMetadataSchema',
  pagedModelAppointmentResponseContract: 'pagedAppointmentResponseSchema',
  publicBarberResponseContract: 'publicBarberResponseSchema',
  registerResponseContract: 'registerResponseSchema',
  serviceItemResponseContract: 'serviceItemResponseSchema',
  shopInfoResponseContract: 'shopInfoResponseSchema',
};

const pairs = Object.entries(VALIDATOR_FOR_CONTRACT) as [
  keyof typeof contracts,
  keyof typeof validators,
][];

describe('response validators match the generated OpenAPI contracts', () => {
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
});
