import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class AskQuestionDto {
  @IsString()
  @IsNotEmpty({ message: 'Question cannot be empty.' })
  @MaxLength(300, { message: 'Question cannot be longer than 300 characters.' })
  question: string;
}
