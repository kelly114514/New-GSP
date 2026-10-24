/**
 * 读取器报错的类型与错误码。
 *
 * 读取器只在“文件结构”层面拒绝输入（规格 §2、§3、§5.5、§8.1 的硬性要求），
 * 每个错误都带出错位置的字节偏移（相对文件开头）和原因。
 */

export type GspErrorCode =
  /** 文件开头不是 `GSP4`（或文件不足 4 字节）。 */
  | 'bad-magic'
  /** 文件在记录头、补齐字节处或者没有写完最后一条记录就结束了。 */
  | 'truncated'
  /** 记录头里的长度超出文件剩余字节。 */
  | 'length-out-of-bounds'
  /** 第一条记录不是（28 字节载荷的）900。 */
  | 'bad-first-record'
  /** 文件在 900 闭合（901）之前就结束了。 */
  | 'bad-last-record'
  /** 结束记录与最近未闭合的开始记录不配对，或文件结束时还有未闭合的开始记录。 */
  | 'unbalanced-nesting'
  /** 成对记录出现在规格不允许的容器里（例如 2000 直接放在 902 里）。 */
  | 'unexpected-nesting'
  /** 902 兼容信封的提示串结构不合规（§5.2、§5.5；原版遇到会崩溃）。 */
  | 'bad-envelope'
  /** 2000 对象头短于 12 字节（原版：格式错误，§8.1）。 */
  | 'bad-object-header';

/** 读取器拒绝输入时抛出的错误。 */
export class GspFormatError extends Error {
  readonly code: GspErrorCode;
  /** 出错位置，相对文件开头的字节偏移。 */
  readonly offset: number;
  /** 不含偏移和错误码的原因说明。 */
  readonly reason: string;

  constructor(code: GspErrorCode, offset: number, reason: string) {
    super(`${reason} [${code} @ byte offset ${offset} (0x${offset.toString(16)})]`);
    this.name = 'GspFormatError';
    this.code = code;
    this.offset = offset;
    this.reason = reason;
  }
}

/**
 * 在文件已通过结构检查之后，解码“对象模型”时遇到载荷形状不对的已知记录
 * （例如 2002 的长度不是 4+4×count）。
 */
export class GspDecodeError extends Error {
  /** 人读的位置，如 `page 0 / object 12 / kind 2002`。 */
  readonly where: string;

  constructor(where: string, reason: string) {
    super(`${reason} (${where})`);
    this.name = 'GspDecodeError';
    this.where = where;
  }
}
