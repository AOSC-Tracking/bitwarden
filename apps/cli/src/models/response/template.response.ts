import { BaseResponse } from "./base.response.js";

export class TemplateResponse implements BaseResponse {
  object: string;
  template: any;

  constructor(template: any) {
    this.object = "template";
    this.template = template;
  }
}
