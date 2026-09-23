import { InvestmentType, investmentTypeKeys } from '@seshat/domain';

export class ListInvestmentTypesUseCase {
  public execute(): readonly InvestmentType[] {
    return investmentTypeKeys.map((key) => InvestmentType.create(key));
  }
}
