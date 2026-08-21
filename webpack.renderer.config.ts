import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';

const isProduction = process.env.NODE_ENV !== 'development';

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  output: {
    assetModuleFilename: 'assets/[name].[contenthash][ext]',
    publicPath: './',
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin(),
    ...(isProduction
      ? [
          new MiniCssExtractPlugin({
            filename: 'assets/[name].[contenthash].css',
          }),
        ]
      : []),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
