import { AccountType, defaultAccountTypeKeys } from '@seshat/domain';

export class ListDefaultAccountTypesUseCase {
  public execute(): readonly AccountType[] {
    return defaultAccountTypeKeys.map((key) => AccountType.create(key));
  }
}
