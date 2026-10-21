import { z } from 'zod';

export const supportedCurrencyCodeSchema = z.enum(['BRL', 'USD', 'EUR']);
export const supportedCurrencyMinorUnitScaleSchema = z.literal(2);
